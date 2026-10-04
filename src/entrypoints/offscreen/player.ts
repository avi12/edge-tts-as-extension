import { chunkText, type TextChunk } from "@/lib/edge-tts/chunk";
import { synthesize } from "@/lib/edge-tts/client";
import { AUDIO_MIME_TYPE } from "@/lib/edge-tts/constants";
import type { WordBoundary } from "@/lib/edge-tts/protocol";
import { type Prosody, sanitizeText } from "@/lib/edge-tts/ssml";
import { createWordLocator } from "@/lib/edge-tts/words";
import { getErrorMessage } from "@/lib/errors";
import { IDLE_STATE, PlayerStatus, type SpeakingState } from "@/lib/player-status";

const WORD_TICK_MS = 50;
const KEEP_BEHIND_SECONDS = 10;
const QUOTA_RETRY_DELAY_MS = 1000;
const QUOTA_EXCEEDED_ERROR = "QuotaExceededError";
const SOURCE_BUFFER_MODE = "sequence";
const SOURCE_OPEN_EVENT = "sourceopen";
const UPDATE_END_EVENT = "updateend";

interface TimedWord {
  time: number;
  start: number;
  length: number;
}

interface SpeakOptions {
  text: string;
  voice: string;
  prosody: Prosody;
}

function ignoreError() {}

function waitForUpdateEnd(sourceBuffer: SourceBuffer) {
  return new Promise(resolve => sourceBuffer.addEventListener(UPDATE_END_EVENT, resolve, { once: true }));
}

function getBufferedEnd(sourceBuffer: SourceBuffer) {
  const { buffered } = sourceBuffer;
  return buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
}

function tryAppendBuffer({ sourceBuffer, bytes }: {
  sourceBuffer: SourceBuffer;
  bytes: Uint8Array<ArrayBuffer>;
}) {
  try {
    sourceBuffer.appendBuffer(bytes);
    return true;
  } catch (error) {
    const isQuotaExceeded = error instanceof DOMException && error.name === QUOTA_EXCEEDED_ERROR;
    if (isQuotaExceeded) {
      return false;
    }

    throw error;
  }
}

// Plays text the way Edge does: streams WebM/Opus from the service straight into a MediaSource, so
// speech starts before the whole text is synthesized. Long text is split into several requests, and
// the SourceBuffer runs in "sequence" mode so each request's audio lands right after the previous one
export function createPlayer(onChange: (state: SpeakingState) => void) {
  const elAudio = new Audio();
  let state = IDLE_STATE;
  let session: AbortController | null = null;
  let words: TimedWord[] = [];
  let tickerId: ReturnType<typeof setInterval> | undefined;

  function setState(patch: Partial<SpeakingState>) {
    state = {
      ...state,
      ...patch
    };
    onChange(state);
  }

  function reportCurrentWord() {
    const now = elAudio.currentTime;
    let currentWord: TimedWord | undefined;
    for (const word of words) {
      if (word.time > now) {
        break;
      }

      currentWord = word;
    }

    const word = currentWord
      ? {
        start: currentWord.start,
        length: currentWord.length
      }
      : null;
    const isNewWord = word?.start !== state.word?.start;
    if (isNewWord) {
      setState({ word });
    }
  }

  function startTicker() {
    if (tickerId !== undefined) {
      return;
    }

    tickerId = setInterval(reportCurrentWord, WORD_TICK_MS);
  }

  function stop() {
    session?.abort();
    session = null;
    elAudio.pause();

    if (elAudio.src) {
      URL.revokeObjectURL(elAudio.src);
    }

    elAudio.removeAttribute("src");
    words = [];
    clearInterval(tickerId);
    tickerId = undefined;

    if (state.status !== PlayerStatus.Idle) {
      setState(IDLE_STATE);
    }
  }

  function finish() {
    const { text, voice } = state;
    stop();
    setState({
      ...IDLE_STATE,
      status: PlayerStatus.Finished,
      text,
      voice
    });
  }

  // Very long text fills the buffer - drop audio that has already been played, or wait for some to play
  async function freePlayedAudio(sourceBuffer: SourceBuffer) {
    const playedEnd = elAudio.currentTime - KEEP_BEHIND_SECONDS;
    if (playedEnd <= 0) {
      await new Promise(resolve => setTimeout(resolve, QUOTA_RETRY_DELAY_MS));
      return;
    }

    sourceBuffer.remove(0, playedEnd);
    await waitForUpdateEnd(sourceBuffer);
  }

  // A SourceBuffer takes one append at a time, so appends are queued. Each resolves with the
  // timeline position where its bytes began
  function createAppender({ sourceBuffer, signal }: {
    sourceBuffer: SourceBuffer;
    signal: AbortSignal;
  }) {
    let queue = Promise.resolve(0);

    async function appendBytes(bytes: Uint8Array<ArrayBuffer>) {
      while (!signal.aborted) {
        const startedAt = getBufferedEnd(sourceBuffer);
        const isAppended = tryAppendBuffer({
          sourceBuffer,
          bytes
        });
        if (isAppended) {
          await waitForUpdateEnd(sourceBuffer);
          startTicker();
          return startedAt;
        }

        await freePlayedAudio(sourceBuffer);
      }

      return getBufferedEnd(sourceBuffer);
    }

    return {
      append(bytes: Uint8Array<ArrayBuffer>) {
        queue = queue.then(() => appendBytes(bytes));
        return queue;
      },
      drained: () => queue
    };
  }

  async function synthesizeChunk({ chunk, spokenText, voice, prosody, signal, appender }: {
    chunk: TextChunk;
    spokenText: string;
    voice: string;
    prosody: Prosody;
    signal: AbortSignal;
    appender: ReturnType<typeof createAppender>;
  }) {
    let chunkStartTime: number | null = null;
    const locateWord = createWordLocator({
      text: spokenText,
      iStart: chunk.start
    });
    const pendingBoundaries: WordBoundary[] = [];

    function placeWord({ boundary, startTime }: {
      boundary: WordBoundary;
      startTime: number;
    }) {
      const iWord = locateWord(boundary.text);
      if (iWord === null) {
        return;
      }

      words.push({
        time: startTime + boundary.time,
        start: iWord,
        length: boundary.text.length
      });
    }

    function onAppended(startedAt: number) {
      if (chunkStartTime !== null) {
        return;
      }

      chunkStartTime = startedAt;
      for (const boundary of pendingBoundaries.splice(0)) {
        placeWord({
          boundary,
          startTime: startedAt
        });
      }

      const isWaitingToStart = elAudio.paused && state.status === PlayerStatus.Loading;
      if (isWaitingToStart) {
        elAudio.play().catch(ignoreError);
      }
    }

    await synthesize({
      text: chunk.text,
      voice,
      prosody,
      signal,
      // A failed append surfaces through drained()
      onAudio: bytes => appender.append(bytes).then(onAppended, ignoreError),
      // Boundaries can arrive before this chunk's audio has a place on the timeline
      onWordBoundary(boundary) {
        if (chunkStartTime === null) {
          pendingBoundaries.push(boundary);
          return;
        }

        placeWord({
          boundary,
          startTime: chunkStartTime
        });
      }
    });
  }

  async function streamText({ text, voice, prosody, signal }: SpeakOptions & { signal: AbortSignal }) {
    const mediaSource = new MediaSource();
    elAudio.src = URL.createObjectURL(mediaSource);
    await new Promise(resolve => mediaSource.addEventListener(SOURCE_OPEN_EVENT, resolve, { once: true }));
    const sourceBuffer = mediaSource.addSourceBuffer(AUDIO_MIME_TYPE);
    sourceBuffer.mode = SOURCE_BUFFER_MODE;
    const appender = createAppender({
      sourceBuffer,
      signal
    });

    const spokenText = sanitizeText(text);
    for (const chunk of chunkText({ text })) {
      await synthesizeChunk({
        chunk,
        spokenText,
        voice,
        prosody,
        signal,
        appender
      });
    }

    await appender.drained();

    if (!signal.aborted) {
      mediaSource.endOfStream();
    }

    startTicker();
  }

  async function speak({ text, voice, prosody }: SpeakOptions) {
    stop();
    const controller = new AbortController();
    session = controller;
    setState({
      ...IDLE_STATE,
      status: PlayerStatus.Loading,
      text,
      voice
    });

    try {
      await streamText({
        text,
        voice,
        prosody,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      stop();
      setState({
        ...IDLE_STATE,
        status: PlayerStatus.Error,
        text,
        voice,
        error: getErrorMessage(error)
      });
    }
  }

  function pause() {
    if (state.status !== PlayerStatus.Playing) {
      return;
    }

    elAudio.pause();
    setState({ status: PlayerStatus.Paused });
  }

  function resume() {
    if (state.status !== PlayerStatus.Paused) {
      return;
    }

    void elAudio.play();
  }

  elAudio.onplaying = () => setState({ status: PlayerStatus.Playing });
  elAudio.onended = finish;

  return {
    speak,
    pause,
    resume,
    stop,
    getState: () => state
  };
}
