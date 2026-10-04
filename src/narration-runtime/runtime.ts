import { createCardOverlay, createTourPanel, PanelAction } from "./ui";
import {
  NARRATION_CUE_EVENT,
  NARRATION_DATA_ID,
  NarrationAttribute,
  type NarrationClip,
  type NarrationData
} from "@/lib/narration";
import { type PlayerState, PlayerStatus, type SpokenWord } from "@/lib/player-status";

const HEADING_SELECTOR = "h1, h2, h3, h4, .card-head";
// Narration walks a card from the top, and tall cards on phones cannot fit beside the panel anyway
const SCROLL_BLOCK = "start";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CUE_SEPARATOR = " ";
const ABORT_ERROR = "AbortError";
const CLIP_LOADED_STATUSES = new Set([PlayerStatus.Playing, PlayerStatus.Paused, PlayerStatus.Finished]);

interface NarratedCard {
  elCard: HTMLElement;
  clip: NarrationClip;
  title: string;
  overlay: ReturnType<typeof createCardOverlay>;
}

function readNarrationData() {
  const json = document.getElementById(NARRATION_DATA_ID)?.textContent;
  if (!json) {
    return null;
  }

  // Written into this same page by the narrate CLI, so it is trusted - zod would add ~300 KB to every artifact
  const data: NarrationData = JSON.parse(json);
  return data;
}

function getCardTitle({ elCard, iCard }: {
  elCard: HTMLElement;
  iCard: number;
}) {
  const explicitTitle = elCard.getAttribute(NarrationAttribute.Title);
  const headingText = elCard.querySelector(HEADING_SELECTOR)?.textContent?.trim();
  return explicitTitle ?? headingText ?? `Part ${iCard + 1}`;
}

function getSpokenWord({ clip, seconds }: {
  clip: NarrationClip;
  seconds: number;
}) {
  let spokenWord: SpokenWord | null = null;
  for (const [time, start, length] of clip.words) {
    if (time > seconds) {
      break;
    }

    spokenWord = {
      start,
      length
    };
  }

  return spokenWord;
}

function startNarration(data: NarrationData) {
  const elAudio = new Audio();
  elAudio.preload = "auto";
  let iActive: number | null = null;
  let isTouring = false;
  let status = PlayerStatus.Idle;
  let error: string | null = null;
  let frameRequest = 0;
  let playRequest = 0;

  const elCards = [...document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.Script}]`)];
  if (elCards.length !== data.clips.length) {
    console.warn(`Narration: ${elCards.length} narrated cards but ${data.clips.length} clips - re-run the narrate CLI`);
  }

  const panel = createTourPanel({
    cardCount: Math.min(elCards.length, data.clips.length),
    onAction: action => void handlePanelAction(action)
  });
  const cards: NarratedCard[] = [];
  for (const [iCard, clip] of data.clips.entries()) {
    const elCard = elCards[iCard];
    if (!elCard) {
      break;
    }

    cards.push({
      elCard,
      clip,
      title: getCardTitle({
        elCard,
        iCard
      }),
      overlay: createCardOverlay({
        elCard,
        onPlay: () => void handleCardButton(iCard)
      })
    });
  }

  function getActiveCard() {
    return iActive === null ? undefined : cards[iActive];
  }

  // Follows the playhead both ways, so a seek back un-cues what has not been said yet
  function markCues(card: NarratedCard) {
    const cuedAttribute = card.elCard.getAttribute(NarrationAttribute.Cued) ?? "";
    const previouslyCued = new Set(cuedAttribute.split(CUE_SEPARATOR).filter(Boolean));
    const playhead = elAudio.ended ? Infinity : elAudio.currentTime;
    const reachedCueNames = new Set<string>();
    for (const [name, time] of card.clip.cues) {
      if (time <= playhead) {
        reachedCueNames.add(name);
      }
    }

    const reachedAttribute = [...reachedCueNames].join(CUE_SEPARATOR);
    if (reachedAttribute !== cuedAttribute) {
      card.elCard.setAttribute(NarrationAttribute.Cued, reachedAttribute);
      for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.Cue}]`)) {
        elCue.toggleAttribute(NarrationAttribute.CueReached, reachedCueNames.has(elCue.getAttribute(NarrationAttribute.Cue) ?? ""));
      }
    }

    for (const cue of reachedCueNames.difference(previouslyCued)) {
      card.elCard.dispatchEvent(
        new CustomEvent(NARRATION_CUE_EVENT, {
          bubbles: true,
          detail: {
            cue
          }
        })
      );
    }
  }

  function render() {
    const card = getActiveCard();
    if (!card) {
      panel.render({
        state: error === null ? null : {
          status: PlayerStatus.Error,
          text: "",
          word: null,
          error
        },
        title: null,
        iCard: null,
        locale: null
      });
      return;
    }

    const isClipLoaded = CLIP_LOADED_STATUSES.has(status);
    if (isClipLoaded) {
      markCues(card);
    }

    card.overlay.setStatus(status);
    const state: PlayerState = {
      status,
      text: card.clip.text,
      word: getSpokenWord({
        clip: card.clip,
        seconds: elAudio.currentTime
      }),
      error
    };
    panel.render({
      state,
      title: card.title,
      iCard: iActive,
      locale: card.clip.locale
    });
  }

  function followAudio() {
    render();

    if (status === PlayerStatus.Playing) {
      frameRequest = requestAnimationFrame(followAudio);
    }
  }

  function releaseActiveCard() {
    cancelAnimationFrame(frameRequest);
    const card = getActiveCard();
    if (card) {
      card.elCard.removeAttribute(NarrationAttribute.Narrating);
      card.elCard.removeAttribute(NarrationAttribute.Cued);
      for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.CueReached}]`)) {
        elCue.removeAttribute(NarrationAttribute.CueReached);
      }

      card.overlay.setStatus(PlayerStatus.Idle);
    }

    iActive = null;
  }

  function stop() {
    isTouring = false;
    elAudio.pause();
    releaseActiveCard();
    status = PlayerStatus.Idle;
    render();
  }

  async function narrateCard(iCard: number) {
    const card = cards[iCard];
    if (!card) {
      stop();
      return;
    }

    releaseActiveCard();
    iActive = iCard;
    error = null;
    status = PlayerStatus.Loading;
    card.elCard.setAttribute(NarrationAttribute.Narrating, "");
    card.elCard.setAttribute(NarrationAttribute.Cued, "");
    card.elCard.scrollIntoView({
      block: SCROLL_BLOCK,
      behavior: matchMedia(REDUCED_MOTION_QUERY).matches ? "instant" : "smooth"
    });
    elAudio.src = card.clip.audio;
    render();
    await play();
  }

  async function play() {
    playRequest += 1;
    const thisPlayRequest = playRequest;
    await elAudio.play().catch((playError: unknown) => {
      const isReplacedByNewerPlay = thisPlayRequest !== playRequest;
      const isInterrupted = playError instanceof DOMException && playError.name === ABORT_ERROR;
      if (isReplacedByNewerPlay || isInterrupted) {
        return;
      }

      error = playError instanceof Error ? playError.message : String(playError);
      stop();
    });
  }

  async function handleCardButton(iCard: number) {
    const isThisCardActive = iActive === iCard;
    const isThisCardStarting = isThisCardActive && status === PlayerStatus.Loading;
    if (isThisCardActive && status === PlayerStatus.Playing) {
      elAudio.pause();
      return;
    }

    if (isThisCardActive && status === PlayerStatus.Paused) {
      await play();
      return;
    }

    if (isThisCardStarting) {
      return;
    }

    isTouring = false;
    await narrateCard(iCard);
  }

  async function handlePanelAction(action: PanelAction) {
    switch (action) {
      case PanelAction.Tour:
        isTouring = true;
        await narrateCard(0);
        return;
      case PanelAction.Previous:
        await narrateCard(Math.max((iActive ?? 0) - 1, 0));
        return;
      case PanelAction.Next:
        await narrateCard((iActive ?? -1) + 1);
        return;
      case PanelAction.Pause:
        elAudio.pause();
        return;
      case PanelAction.Resume:
        await play();
        return;
      case PanelAction.Stop:
        stop();
    }
  }

  elAudio.addEventListener("playing", () => {
    status = PlayerStatus.Playing;
    cancelAnimationFrame(frameRequest);
    followAudio();
  });
  elAudio.addEventListener("pause", () => {
    if (elAudio.ended || iActive === null) {
      return;
    }

    status = PlayerStatus.Paused;
    render();
  });
  elAudio.addEventListener("seeked", render);
  elAudio.addEventListener("ended", () => {
    status = PlayerStatus.Finished;
    render();
    const iNext = (iActive ?? 0) + 1;
    const isTourContinuing = isTouring && iNext < cards.length;
    if (isTourContinuing) {
      void narrateCard(iNext);
      return;
    }

    stop();
  });

  render();
}

const narrationData = readNarrationData();
if (narrationData) {
  startNarration(narrationData);
}
