import type { NarrationEngine } from "./engine";
import { extensionVoices } from "./extension-voices";
import { createLiveEngine } from "./live-engine";
import { PanelAction } from "./panel-action";
import { createRecordedEngine } from "./recorded-engine";
import { createCardOverlay, createTourPanel } from "./ui";
import type { Voice } from "@/lib/edge-tts/voice-list";
import { type CueTiming, NARRATION_CUE_EVENT, NarrationAttribute, type NarrationClip, type NarrationData } from "@/lib/narration";
import { findNarrationHost, type HostRecording } from "@/lib/narration-host";
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
// A locale is language-region (BCP 47), and a voice reads any text in its own language, whatever region
// https://www.rfc-editor.org/rfc/rfc5646#section-2.1
const LOCALE_SEPARATOR = "-";
// The service's multilingual voices carry the word in their ShortName, and read text in any language
// https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts#multilingual-voices
const MULTILINGUAL_MARKER = "Multilingual";

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
  const explicitTitle = elCard.getAttribute(NarrationAttribute.TITLE);
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
  const isFinished = state.status === PlayerStatus.FINISHED;
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
  const cuedAttribute = card.elCard.getAttribute(NarrationAttribute.CUED) ?? "";
  const previouslyCued = new Set(cuedAttribute.split(CUE_SEPARATOR).filter(Boolean));
  const reachedCueNames = getReachedCueNames({
    clip: card.clip,
    state
  });
  const reachedAttribute = [...reachedCueNames].join(CUE_SEPARATOR);
  const isCuedAttributeStale = reachedAttribute !== cuedAttribute;
  if (isCuedAttributeStale) {
    card.elCard.setAttribute(NarrationAttribute.CUED, reachedAttribute);
    for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.CUE}]`)) {
      elCue.toggleAttribute(NarrationAttribute.CUE_REACHED, reachedCueNames.has(elCue.getAttribute(NarrationAttribute.CUE) ?? ""));
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

function getLanguage(locale: string) {
  return locale.split(LOCALE_SEPARATOR)[0]?.toLowerCase() ?? "";
}

// A pinned voice is the author's call, and a voice can only take over a card it can read
function canReadCard({ clip, voice }: {
  clip: NarrationClip;
  voice: Voice;
}) {
  if (clip.pinnedVoice) {
    return false;
  }

  return voice.ShortName.includes(MULTILINGUAL_MARKER) || getLanguage(voice.Locale) === getLanguage(clip.locale);
}

// A cue's time follows the first word at or after it, as the narrate CLI times it
function toHostClip({ clip, voice, recording }: {
  clip: NarrationClip;
  voice: Voice;
  recording: HostRecording;
}) {
  const cues: CueTiming[] = [];
  for (const [name, , start] of clip.cues) {
    const firstWordAfterCue = recording.words.find(([, iWord]) => iWord >= start);
    cues.push([name, firstWordAfterCue?.[0] ?? recording.duration, start]);
  }

  return {
    ...clip,
    ...recording,
    voice: voice.ShortName,
    locale: voice.Locale,
    cues
  };
}

function releaseCard(card: NarratedCard) {
  card.elCard.removeAttribute(NarrationAttribute.NARRATING);
  card.elCard.removeAttribute(NarrationAttribute.CUED);
  for (const elCue of card.elCard.querySelectorAll(`[${NarrationAttribute.CUE_REACHED}]`)) {
    elCue.removeAttribute(NarrationAttribute.CUE_REACHED);
  }

  card.overlay.setStatus(PlayerStatus.IDLE);
}

export function startNarration(data: NarrationData) {
  let iActive: number | null = null;
  let isTouring = false;
  let state: SpeakingState | null = null;
  let error: string | null = null;

  const recordedEngine = createRecordedEngine(followEngine);
  const liveEngine = createLiveEngine(followEngine);
  let engine: NarrationEngine = recordedEngine;
  const host = findNarrationHost();
  const voiceSource = host ?? extensionVoices;
  let voices: Voice[] = [];
  let pickedVoice: string | null = null;
  // One recording per card and voice, shared by a play, a voice switch and the tour's look-ahead
  const recordings = new Map<string, Promise<NarrationClip>>();
  let activeClip: NarrationClip | null = null;
  // Recording takes a moment, and only the newest request may start playing once it is back
  let playRequest = 0;

  const elCards = [...document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.SCRIPT}]`)];
  if (elCards.length !== data.clips.length) {
    console.warn(`Narration: ${elCards.length} narrated cards but ${data.clips.length} clips - re-run the narrate CLI`);
  }

  const panel = createTourPanel({
    cardCount: Math.min(elCards.length, data.clips.length),
    onAction: handlePanelAction,
    onSeek: seek,
    onVoice: changeVoice
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

  function getHostVoice(clip: NarrationClip) {
    const voice = voices.find(candidate => candidate.ShortName === pickedVoice);
    const isRecordedVoice = voice?.ShortName === clip.voice;
    if (!host) {
      return null;
    }

    if (!voice) {
      return null;
    }

    if (isRecordedVoice) {
      return null;
    }

    return canReadCard({
      clip,
      voice
    }) ? voice : null;
  }

  // A recording that fails falls back to the embedded one, so the card still speaks
  async function getClip(clip: NarrationClip) {
    const voice = getHostVoice(clip);
    if (!host) {
      return clip;
    }

    if (!voice) {
      return clip;
    }

    const key = `${voice.ShortName}\n${clip.text}`;
    let recording = recordings.get(key);
    if (!recording) {
      recording = host.record({
        text: clip.text,
        voice: voice.ShortName
      }).then(hostRecording => toHostClip({
        clip,
        voice,
        recording: hostRecording
      }));
      recordings.set(key, recording);
    }

    return recording.catch((recordError: unknown) => {
      recordings.delete(key);
      console.warn(`Narration: could not record in ${voice.ShortName}`, recordError);
      return clip;
    });
  }

  function getPanelVoice() {
    return pickedVoice ?? activeClip?.voice ?? data.clips[0]?.voice ?? "";
  }

  function getStatus() {
    return state?.status ?? PlayerStatus.IDLE;
  }

  function renderWithoutCard() {
    panel.render({
      state: error === null ? null : {
        status: PlayerStatus.ERROR,
        text: "",
        word: null,
        error,
        voice: null,
        source: null
      },
      title: null,
      iCard: null,
      locale: null,
      voices,
      voice: getPanelVoice()
    });
  }

  function render() {
    const card = getActiveCard();
    if (!card) {
      renderWithoutCard();
      return;
    }

    if (!state) {
      renderWithoutCard();
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
      locale: (activeClip ?? card.clip).locale,
      voices,
      voice: getPanelVoice()
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
    activeClip = null;
    state = null;
    playRequest += 1;
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
    card.elCard.setAttribute(NarrationAttribute.NARRATING, "");
    card.elCard.setAttribute(NarrationAttribute.CUED, "");
    card.elCard.scrollIntoView({
      block: SCROLL_BLOCK,
      behavior: matchMedia(REDUCED_MOTION_QUERY).matches ? "instant" : "smooth"
    });
    // Each engine replaces its own clip in place; stopping first would read as the player being stopped
    // A page narrated by the extension alone has no recording to play, so it always speaks live
    const isLive = liveEngine.isAvailable() || !hasRecording(card.clip);
    const nextEngine = isLive ? liveEngine : recordedEngine;
    const isEngineChanged = nextEngine !== engine;
    if (isEngineChanged) {
      await engine.stop();
      engine = nextEngine;
    }

    playRequest += 1;
    const thisPlayRequest = playRequest;
    const isRecording = !isLive && getHostVoice(card.clip) !== null;
    if (isRecording) {
      await engine.pause();
      showLoading(card.clip);
    }

    const clip = isLive ? card.clip : await getClip(card.clip);
    const isSuperseded = thisPlayRequest !== playRequest;
    if (isSuperseded) {
      return;
    }

    activeClip = clip;
    await engine.play(clip);
    const nextCard = cards[iCard + 1];
    const shouldPrefetchNext = isTouring && nextCard && !isLive;
    if (shouldPrefetchNext) {
      void getClip(nextCard.clip);
    }
  }

  function showLoading(clip: NarrationClip) {
    state = {
      status: PlayerStatus.LOADING,
      text: clip.text,
      word: state?.word ?? null,
      error: null,
      voice: pickedVoice,
      source: null
    };
    render();
  }

  // The new voice carries on from the word the old one was on, paused if it was paused
  async function changeVoice(voice: string) {
    pickedVoice = voice;
    render();
    void voiceSource.setVoice(voice);
    const card = getActiveCard();
    if (!card) {
      return;
    }

    if (!state) {
      return;
    }

    const isRecordedEngine = engine === recordedEngine;
    if (!isRecordedEngine) {
      return;
    }

    const resumeAt = state.word?.start ?? 0;
    const isPaused = state.status === PlayerStatus.PAUSED;
    playRequest += 1;
    const thisPlayRequest = playRequest;
    await recordedEngine.pause();
    showLoading(card.clip);
    const clip = await getClip(card.clip);
    const isSuperseded = thisPlayRequest !== playRequest;
    if (isSuperseded) {
      return;
    }

    activeClip = clip;
    await recordedEngine.playFrom({
      nextClip: clip,
      start: resumeAt
    });

    if (isPaused) {
      await recordedEngine.pause();
    }
  }

  // Both engines report here; only the active card's own text counts
  async function followEngine(nextState: SpeakingState) {
    const card = getActiveCard();
    if (!card) {
      return;
    }

    const isStateForActiveCard = nextState.text === card.clip.text || nextState.status === PlayerStatus.IDLE;
    if (!isStateForActiveCard) {
      return;
    }

    const isLiveFailure = engine === liveEngine && nextState.status === PlayerStatus.ERROR;
    const shouldFallBackToRecording = isLiveFailure && hasRecording(card.clip);
    if (shouldFallBackToRecording) {
      engine = recordedEngine;
      await recordedEngine.play(card.clip);
      return;
    }

    if (nextState.status === PlayerStatus.IDLE) {
      await stop();
      return;
    }

    state = nextState;

    if (nextState.status === PlayerStatus.ERROR) {
      error = nextState.error;
      await stop();
      return;
    }

    render();

    if (nextState.status !== PlayerStatus.FINISHED) {
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
    const isPlaying = isThisCardActive && status === PlayerStatus.PLAYING;
    const isPaused = isThisCardActive && status === PlayerStatus.PAUSED;
    const isLoading = isThisCardActive && status === PlayerStatus.LOADING;
    if (isPlaying) {
      await engine.pause();
      return;
    }

    if (isPaused) {
      await engine.resume();
      return;
    }

    if (isLoading) {
      return;
    }

    isTouring = false;
    await narrateCard(iCard);
  }

  async function handlePanelAction(action: PanelAction) {
    switch (action) {
      case PanelAction.TOUR:
        isTouring = true;
        await narrateCard(0);
        return;
      case PanelAction.PREVIOUS:
        await narrateCard(Math.max((iActive ?? 0) - 1, 0));
        return;
      case PanelAction.NEXT:
        await narrateCard((iActive ?? -1) + 1);
        return;
      case PanelAction.BACK:
        await seek(
          findBackTarget({
            text: getActiveCard()?.clip.text ?? "",
            spokenStart: state?.word?.start ?? 0
          })
        );
        return;
      case PanelAction.PAUSE:
        await engine.pause();
        return;
      case PanelAction.RESUME:
        await engine.resume();
        return;
      case PanelAction.STOP:
        await stop();
    }
  }

  render();

  void Promise.all([voiceSource.listVoices(), voiceSource.getVoice()]).then(([sourceVoices, savedVoice]) => {
    voices = sourceVoices;
    pickedVoice = savedVoice;
    render();
  }).catch((sourceError: unknown) => console.warn("Narration: no voices to offer", sourceError));
}
