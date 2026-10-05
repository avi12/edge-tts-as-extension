import type { NarrationEngine } from "./engine";
import { createLiveEngine } from "./live-engine";
import { createRecordedEngine } from "./recorded-engine";
import { createCardOverlay, createTourPanel, PanelAction } from "./ui";
import {
  NARRATION_CUE_EVENT,
  NARRATION_DATA_ID,
  NarrationAttribute,
  type NarrationClip,
  type NarrationData
} from "@/lib/narration";
import { PlayerStatus, type SpeakingState } from "@/lib/player-status";

const HEADING_SELECTOR = "h1, h2, h3, h4, .card-head";
// Narration walks a card from the top, and tall cards on phones cannot fit beside the panel anyway
const SCROLL_BLOCK = "start";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CUE_SEPARATOR = " ";
const SENTENCE_START = /(?:^|[.!?]\s+)(?=\S)/g;
// Back from the first few characters of a sentence goes to the previous one, like a music player's back button
const BACK_GRACE_CHARACTERS = 12;

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

// A cue is reached once the voice is on (or past) the word it sits before - by text position, which a
// recorded clip and a live voice both report
function getReachedCueNames({ clip, state }: {
  clip: NarrationClip;
  state: SpeakingState;
}) {
  const reachedCueNames = new Set<string>();
  const isFinished = state.status === PlayerStatus.Finished;
  const spokenStart = state.word?.start ?? -1;
  for (const [name, , start] of clip.cues) {
    if (isFinished || start <= spokenStart) {
      reachedCueNames.add(name);
    }
  }

  return reachedCueNames;
}

function markCues({ card, state }: {
  card: NarratedCard;
  state: SpeakingState;
}) {
  const cuedAttribute = card.elCard.getAttribute(NarrationAttribute.Cued) ?? "";
  const previouslyCued = new Set(cuedAttribute.split(CUE_SEPARATOR).filter(Boolean));
  const reachedCueNames = getReachedCueNames({
    clip: card.clip,
    state
  });
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

function findBackTarget({ text, spokenStart }: {
  text: string;
  spokenStart: number;
}) {
  let target = 0;
  for (const match of text.matchAll(SENTENCE_START)) {
    const sentenceStart = match.index + match[0].length;
    if (sentenceStart > spokenStart - BACK_GRACE_CHARACTERS) {
      break;
    }

    target = sentenceStart;
  }

  return target;
}

function releaseCard(card: NarratedCard) {
  card.elCard.removeAttribute(NarrationAttribute.Narrating);
  card.elCard.removeAttribute(NarrationAttribute.Cued);
  for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.CueReached}]`)) {
    elCue.removeAttribute(NarrationAttribute.CueReached);
  }

  card.overlay.setStatus(PlayerStatus.Idle);
}

function startNarration(data: NarrationData) {
  let iActive: number | null = null;
  let isTouring = false;
  let state: SpeakingState | null = null;
  let error: string | null = null;

  const recordedEngine = createRecordedEngine(followEngine);
  const liveEngine = createLiveEngine(followEngine);
  let engine: NarrationEngine = recordedEngine;

  const elCards = [...document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.Script}]`)];
  if (elCards.length !== data.clips.length) {
    console.warn(`Narration: ${elCards.length} narrated cards but ${data.clips.length} clips - re-run the narrate CLI`);
  }

  const panel = createTourPanel({
    cardCount: Math.min(elCards.length, data.clips.length),
    onAction: action => void handlePanelAction(action),
    onSeek: start => seek(start)
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

  function getStatus() {
    return state?.status ?? PlayerStatus.Idle;
  }

  function render() {
    const card = getActiveCard();
    if (!card || !state) {
      panel.render({
        state: error === null ? null : {
          status: PlayerStatus.Error,
          text: "",
          word: null,
          error,
          voice: null
        },
        title: null,
        iCard: null,
        locale: null
      });
      return;
    }

    markCues({
      card,
      state
    });
    card.overlay.setStatus(state.status);
    panel.render({
      state,
      title: card.title,
      iCard: iActive,
      locale: card.clip.locale
    });
  }

  function stop() {
    isTouring = false;
    engine.stop();
    const card = getActiveCard();
    if (card) {
      releaseCard(card);
    }

    iActive = null;
    state = null;
    render();
  }

  async function narrateCard(iCard: number) {
    const card = cards[iCard];
    if (!card) {
      stop();
      return;
    }

    const previousCard = getActiveCard();
    if (previousCard) {
      releaseCard(previousCard);
    }

    iActive = iCard;
    error = null;
    card.elCard.setAttribute(NarrationAttribute.Narrating, "");
    card.elCard.setAttribute(NarrationAttribute.Cued, "");
    card.elCard.scrollIntoView({
      block: SCROLL_BLOCK,
      behavior: matchMedia(REDUCED_MOTION_QUERY).matches ? "instant" : "smooth"
    });
    // Each engine replaces its own clip in place; stopping first would read as the player being stopped
    const nextEngine = liveEngine.isAvailable() ? liveEngine : recordedEngine;
    if (nextEngine !== engine) {
      engine.stop();
      engine = nextEngine;
    }

    await engine.play(card.clip);
  }

  // Both engines report here; only the active card's own text counts
  function followEngine(nextState: SpeakingState) {
    const card = getActiveCard();
    if (!card || nextState.text !== card.clip.text && nextState.status !== PlayerStatus.Idle) {
      return;
    }

    const isLiveFailure = engine === liveEngine && nextState.status === PlayerStatus.Error;
    if (isLiveFailure) {
      engine = recordedEngine;
      void recordedEngine.play(card.clip);
      return;
    }

    if (nextState.status === PlayerStatus.Idle) {
      stop();
      return;
    }

    state = nextState;

    if (nextState.status === PlayerStatus.Error) {
      error = nextState.error;
      stop();
      return;
    }

    render();

    if (nextState.status !== PlayerStatus.Finished) {
      return;
    }

    const iNext = (iActive ?? 0) + 1;
    const isTourContinuing = isTouring && iNext < cards.length;
    if (isTourContinuing) {
      void narrateCard(iNext);
      return;
    }

    stop();
  }

  function seek(start: number) {
    if (iActive === null) {
      return;
    }

    engine.seek(start);
  }

  async function handleCardButton(iCard: number) {
    const isThisCardActive = iActive === iCard;
    const status = getStatus();
    if (isThisCardActive && status === PlayerStatus.Playing) {
      engine.pause();
      return;
    }

    if (isThisCardActive && status === PlayerStatus.Paused) {
      await engine.resume();
      return;
    }

    if (isThisCardActive && status === PlayerStatus.Loading) {
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
      case PanelAction.Back:
        seek(
          findBackTarget({
            text: getActiveCard()?.clip.text ?? "",
            spokenStart: state?.word?.start ?? 0
          })
        );
        return;
      case PanelAction.Pause:
        engine.pause();
        return;
      case PanelAction.Resume:
        await engine.resume();
        return;
      case PanelAction.Stop:
        stop();
    }
  }

  render();
}

const narrationData = readNarrationData();
if (narrationData) {
  startNarration(narrationData);
}
