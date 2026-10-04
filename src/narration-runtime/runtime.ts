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
const SCROLL_BLOCK = "center";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CUE_SEPARATOR = " ";
const ABORT_ERROR = "AbortError";

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

  function markCues(card: NarratedCard) {
    const cuedAttribute = card.elCard.getAttribute(NarrationAttribute.Cued) ?? "";
    const previouslyCued = new Set(cuedAttribute.split(CUE_SEPARATOR).filter(Boolean));
    const reachedCueNames = new Set<string>();
    for (const [name, time] of card.clip.cues) {
      if (time <= elAudio.currentTime) {
        reachedCueNames.add(name);
      }
    }

    const newCueNames = [...reachedCueNames].filter(name => !previouslyCued.has(name));
    if (newCueNames.length === 0) {
      return;
    }

    card.elCard.setAttribute(NarrationAttribute.Cued, [...reachedCueNames].join(CUE_SEPARATOR));
    for (const cue of newCueNames) {
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
        iCard: null
      });
      return;
    }

    const isClipRunning = status === PlayerStatus.Playing || status === PlayerStatus.Paused;
    if (isClipRunning) {
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
      iCard: iActive
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
    isTouring = false;
    const isThisCardActive = iActive === iCard;
    if (isThisCardActive && status === PlayerStatus.Playing) {
      elAudio.pause();
      return;
    }

    if (isThisCardActive && status === PlayerStatus.Paused) {
      await elAudio.play();
      return;
    }

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
        await elAudio.play();
        return;
      case PanelAction.Stop:
        stop();
    }
  }

  elAudio.addEventListener("playing", () => {
    status = PlayerStatus.Playing;
    followAudio();
  });
  elAudio.addEventListener("pause", () => {
    if (elAudio.ended || iActive === null) {
      return;
    }

    status = PlayerStatus.Paused;
    render();
  });
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
