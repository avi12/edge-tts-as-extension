import type { NarrationEngine, ReportState } from "./engine";
import type { NarrationClip } from "@/lib/narration";
import { PlayerStatus, type SpokenWord } from "@/lib/player-status";

const ABORT_ERROR = "AbortError";

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

// Plays the audio the narrate CLI embedded in the page - works in any browser
export function createRecordedEngine(reportState: ReportState) {
  const elAudio = new Audio();
  elAudio.preload = "auto";
  let clip: NarrationClip | null = null;
  let status = PlayerStatus.Idle;
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
      voice: clip.voice
    });
  }

  function followAudio() {
    report();

    if (status === PlayerStatus.Playing) {
      frameRequest = requestAnimationFrame(followAudio);
    }
  }

  async function start() {
    playRequest += 1;
    const thisPlayRequest = playRequest;
    await elAudio.play().catch((playError: unknown) => {
      const isReplacedByNewerPlay = thisPlayRequest !== playRequest;
      const isInterrupted = playError instanceof DOMException && playError.name === ABORT_ERROR;
      if (isReplacedByNewerPlay || isInterrupted) {
        return;
      }

      error = playError instanceof Error ? playError.message : String(playError);
      status = PlayerStatus.Error;
      report();
    });
  }

  elAudio.addEventListener("playing", () => {
    status = PlayerStatus.Playing;
    cancelAnimationFrame(frameRequest);
    followAudio();
  });
  elAudio.addEventListener("pause", () => {
    if (elAudio.ended || !clip) {
      return;
    }

    status = PlayerStatus.Paused;
    report();
  });
  elAudio.addEventListener("seeked", report);
  elAudio.addEventListener("ended", () => {
    status = PlayerStatus.Finished;
    report();
  });

  const engine: NarrationEngine = {
    async play(nextClip) {
      cancelAnimationFrame(frameRequest);
      clip = nextClip;
      error = null;
      status = PlayerStatus.Loading;
      elAudio.src = nextClip.audio;
      report();
      await start();
    },
    async pause() {
      elAudio.pause();
    },
    resume: start,
    async seek(start) {
      const word = clip?.words.find(([, wordStart]) => wordStart >= start);
      if (!word) {
        return;
      }

      elAudio.currentTime = word[0];
    },
    async stop() {
      clip = null;
      status = PlayerStatus.Idle;
      cancelAnimationFrame(frameRequest);
      elAudio.pause();
    }
  };
  return engine;
}
