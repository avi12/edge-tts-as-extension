import type { NarrationEngine, ReportState } from "./engine";
import type { NarrationClip } from "@/lib/narration";
import { PlayerStatus, type SpokenWord } from "@/lib/player-status";

// Setting src runs the media element load algorithm, which rejects the play promise still in flight with
// this name - an interruption, not a failure to report
// https://html.spec.whatwg.org/multipage/media.html#media-load-algorithm
const ABORT_ERROR = "AbortError";

function getSpokenWord({ clip, seconds }: {
  clip: NarrationClip;
  seconds: number;
}) {
  let spokenWord: SpokenWord | null = null;
  for (const [time, start, length] of clip.words) {
    const isAhead = time > seconds;
    if (isAhead) {
      break;
    }

    spokenWord = {
      start,
      length
    };
  }

  return spokenWord;
}

// Plays the audio the narrate CLI embedded in the page - works in any browser
export function createRecordedEngine(reportState: ReportState) {
  const elAudio = new Audio();
  // "auto" asks for the whole clip up front - a hint the browser may ignore, and a cheap one here, since
  // the source is a data URI already in the page
  // https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/preload
  elAudio.preload = "auto";
  let clip: NarrationClip | null = null;
  let status = PlayerStatus.IDLE;
  let error: string | null = null;
  let frameRequest = 0;
  let playRequest = 0;

  function report() {
    if (!clip) {
      return;
    }

    reportState({
      status,
      text: clip.text,
      word: getSpokenWord({
        clip,
        seconds: elAudio.currentTime
      }),
      error,
      voice: clip.voice,
      source: null
    });
  }

  function followAudio() {
    report();

    if (status === PlayerStatus.PLAYING) {
      frameRequest = requestAnimationFrame(followAudio);
    }
  }

  async function start() {
    playRequest += 1;
    const thisPlayRequest = playRequest;
    await elAudio.play().catch((playError: unknown) => {
      const isReplacedByNewerPlay = thisPlayRequest !== playRequest;
      const isInterrupted = playError instanceof DOMException && playError.name === ABORT_ERROR;
      const isStale = isReplacedByNewerPlay || isInterrupted;
      if (isStale) {
        return;
      }

      error = playError instanceof Error ? playError.message : String(playError);
      status = PlayerStatus.ERROR;
      report();
    });
  }

  elAudio.addEventListener("playing", () => {
    status = PlayerStatus.PLAYING;
    cancelAnimationFrame(frameRequest);
    followAudio();
  });
  elAudio.addEventListener("pause", () => {
    if (elAudio.ended) {
      return;
    }

    if (!clip) {
      return;
    }

    status = PlayerStatus.PAUSED;
    report();
  });
  elAudio.addEventListener("seeked", report);
  elAudio.addEventListener("ended", () => {
    status = PlayerStatus.FINISHED;
    report();
  });

  function findWordTime(start: number) {
    return clip?.words.find(([, wordStart]) => wordStart >= start)?.[0] ?? null;
  }

  // A clip in another voice says the same text, so a switch picks it up at the word the last one was on.
  // A position set before the audio loads becomes where it starts playing
  // https://html.spec.whatwg.org/multipage/media.html#default-playback-start-position
  async function playFrom({ nextClip, start: startText }: {
    nextClip: NarrationClip;
    start: number;
  }) {
    cancelAnimationFrame(frameRequest);
    clip = nextClip;
    error = null;
    status = PlayerStatus.LOADING;
    elAudio.src = nextClip.audio;
    elAudio.currentTime = findWordTime(startText) ?? 0;
    report();
    await start();
  }

  const engine: NarrationEngine = {
    async play(nextClip) {
      await playFrom({
        nextClip,
        start: 0
      });
    },
    async pause() {
      elAudio.pause();
    },
    resume: start,
    async seek(startText) {
      const wordTime = findWordTime(startText);
      if (wordTime === null) {
        return;
      }

      elAudio.currentTime = wordTime;
    },
    async stop() {
      clip = null;
      status = PlayerStatus.IDLE;
      cancelAnimationFrame(frameRequest);
      elAudio.pause();
    }
  };
  return {
    ...engine,
    playFrom
  };
}
