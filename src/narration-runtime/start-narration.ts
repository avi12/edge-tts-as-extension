import type { NarrationEngine } from "./engine";
import { createLiveEngine } from "./live-engine";
import { createRecordedEngine } from "./recorded-engine";
import { createCardOverlay, createTourPanel, PanelAction } from "./ui";
import { NARRATION_CUE_EVENT, NarrationAttribute, type NarrationClip, type NarrationData } from "@/lib/narration";
import { PlayerStatus, type SpeakingState } from "@/lib/player-status";

// Ours: the headings a card is likely to carry, plus the skin's own card header class
const HEADING_SELECTOR = "h1, h2, h3, h4, .card-head";
// Narration walks a card from the top, and tall cards on phones cannot fit beside the panel anyway -
// "start" is also scrollIntoView's own default, named here because the choice is deliberate
// https://developer.mozilla.org/docs/Web/API/Element/scrollIntoView
const SCROLL_BLOCK = "start";
// The OS-level reduce-motion setting, which decides whether the jump to a card animates
// https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
// data-cued is a space-separated list of names, as the narration contract promises page authors (README.md)
const CUE_SEPARATOR = " ";
// Ours: narration scripts are plain spoken prose, so a full stop, bang or question mark plus whitespace
// is as much sentence splitting as the back button needs
const SENTENCE_START = /(?:^|[.!?]\s+)(?=\S)/g;
// Back from the first few characters of a sentence goes to the previous one, like a music player's back
// button - the count is tuned by hand
const BACK_GRACE_CHARACTERS = 12;

interface NarratedCard {
  elCard: HTMLElement;
  clip: NarrationClip;
  title: string;
  overlay: ReturnType<typeof createCardOverlay>;
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
    const isCueReached = isFinished || start <= spokenStart;
    if (isCueReached) {
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

function hasRecording(clip: NarrationClip) {
  return clip.audio !== "";
}

function releaseCard(card: NarratedCard) {
  card.elCard.removeAttribute(NarrationAttribute.Narrating);
  card.elCard.removeAttribute(NarrationAttribute.Cued);
  for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.CueReached}]`)) {
    elCue.removeAttribute(NarrationAttribute.CueReached);
  }

  card.overlay.setStatus(PlayerStatus.Idle);
}

export function startNarration(data: NarrationData) {
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
    onAction: handlePanelAction,
    onSeek: seek
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
        onPlay: () => handleCardButton(iCard)
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
          voice: null,
          source: null
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

  // The card is released before the engine is told, so no state can arrive for a card already let go
  async function stop() {
    isTouring = false;
    const card = getActiveCard();
    if (card) {
      releaseCard(card);
    }

    iActive = null;
    state = null;
    render();
    await engine.stop();
  }

  async function narrateCard(iCard: number) {
    const card = cards[iCard];
    if (!card) {
      await stop();
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
    // A page narrated by the extension alone has no recording to play, so it always speaks live
    const isLive = liveEngine.isAvailable() || !hasRecording(card.clip);
    const nextEngine = isLive ? liveEngine : recordedEngine;
    if (nextEngine !== engine) {
      await engine.stop();
      engine = nextEngine;
    }

    await engine.play(card.clip);
  }

  // Both engines report here; only the active card's own text counts
  async function followEngine(nextState: SpeakingState) {
    const card = getActiveCard();
    if (!card) {
      return;
    }

    const isStateForActiveCard = nextState.text === card.clip.text || nextState.status === PlayerStatus.Idle;
    if (!isStateForActiveCard) {
      return;
    }

    const isLiveFailure = engine === liveEngine && nextState.status === PlayerStatus.Error;
    if (isLiveFailure && hasRecording(card.clip)) {
      engine = recordedEngine;
      await recordedEngine.play(card.clip);
      return;
    }

    if (nextState.status === PlayerStatus.Idle) {
      await stop();
      return;
    }

    state = nextState;

    if (nextState.status === PlayerStatus.Error) {
      error = nextState.error;
      await stop();
      return;
    }

    render();

    if (nextState.status !== PlayerStatus.Finished) {
      return;
    }

    const iNext = (iActive ?? 0) + 1;
    const isTourContinuing = isTouring && iNext < cards.length;
    if (isTourContinuing) {
      await narrateCard(iNext);
      return;
    }

    await stop();
  }

  async function seek(start: number) {
    if (iActive === null) {
      return;
    }

    await engine.seek(start);
  }

  async function handleCardButton(iCard: number) {
    const isThisCardActive = iActive === iCard;
    const status = getStatus();
    if (isThisCardActive && status === PlayerStatus.Playing) {
      await engine.pause();
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
        await seek(
          findBackTarget({
            text: getActiveCard()?.clip.text ?? "",
            spokenStart: state?.word?.start ?? 0
          })
        );
        return;
      case PanelAction.Pause:
        await engine.pause();
        return;
      case PanelAction.Resume:
        await engine.resume();
        return;
      case PanelAction.Stop:
        await stop();
    }
  }

  render();
}
