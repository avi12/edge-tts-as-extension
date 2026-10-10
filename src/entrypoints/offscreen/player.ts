import { chunkText, type TextChunk } from "@/lib/edge-tts/chunk";
import { synthesize } from "@/lib/edge-tts/client";
import { DEFAULT_OUTPUT_FORMAT, OUTPUT_MIME_TYPES } from "@/lib/edge-tts/constants";
import type { WordBoundary } from "@/lib/edge-tts/protocol";
import { type Prosody, sanitizeText } from "@/lib/edge-tts/ssml";
import { createWordLocator } from "@/lib/edge-tts/words";
import { getErrorMessage } from "@/lib/errors";
import type { PlayerSpeakRequest } from "@/lib/messages";
import { IDLE_STATE, PlayerStatus, type SpeakingState } from "@/lib/player-status";

// The next four are ours, tuned for read-along highlighting, not the platform's: how often the spoken
// word is recomputed from the audio clock, how much played audio is kept behind the playhead when the
// buffer has to be trimmed, and how long to wait for playback when there is nothing behind to drop yet
const WORD_TICK_MS = 50;
const KEEP_BEHIND_SECONDS = 10;
const QUOTA_RETRY_DELAY_MS = 1000;

// What appendBuffer throws when "the buffer is full, and no more data can be appended"
// https://developer.mozilla.org/docs/Web/API/SourceBuffer/appendBuffer
const QUOTA_EXCEEDED_ERROR = "QuotaExceededError";

// "The order in which the segments are appended to the SourceBuffer determines the order in which they
// are played. Segment timestamps are generated automatically" - what several separate requests need,
// since each one's audio starts its own timeline at zero
// https://developer.mozilla.org/docs/Web/API/SourceBuffer/mode
const SOURCE_BUFFER_MODE = "sequence";

// addSourceBuffer throws InvalidStateError unless the MediaSource readyState is "open", which this
// event is what announces
// https://developer.mozilla.org/docs/Web/API/MediaSource/sourceopen_event
const SOURCE_OPEN_EVENT = "sourceopen";

// The event that says an append or a remove finished - appendBuffer throws while the SourceBuffer's
// updating flag is true, so "you must wait for the updateend event before calling appendBuffer() again"
// https://developer.mozilla.org/docs/Web/API/SourceBuffer/updateend_event
const UPDATE_END_EVENT = "updateend";

interface TimedWord {
  time: number;
  start: number;
  length: number;
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

  // Silent, so replacing or finishing a reading never flashes an idle state - idle means stopped
  function release() {
    session?.abort();
    session = null;
    elAudio.pause();

    // An object URL keeps its MediaSource alive until it is revoked, so every reading releases its own
    // https://developer.mozilla.org/docs/Web/API/URL/revokeObjectURL_static
    if (elAudio.src) {
      URL.revokeObjectURL(elAudio.src);
    }

    elAudio.removeAttribute("src");
    words = [];
    clearInterval(tickerId);
    tickerId = undefined;
  }

  function stop() {
    release();

    if (state.status !== PlayerStatus.Idle) {
      setState(IDLE_STATE);
    }
  }

  function finish() {
    const { text, voice } = state;
    release();
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

    async function onAppended(startedAt: number) {
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
        await elAudio.play().catch(ignoreError);
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

  async function streamText({ text, voice, prosody, signal }: Omit<PlayerSpeakRequest, "source"> & {
    signal: AbortSignal;
  }) {
    const mediaSource = new MediaSource();
    // createObjectURL takes "a Blob (such as a File) or MediaSource object", which is the only way an
    // audio element reads from a MediaSource
    // https://developer.mozilla.org/docs/Web/API/URL/createObjectURL_static
    elAudio.src = URL.createObjectURL(mediaSource);
    await new Promise(resolve => mediaSource.addEventListener(SOURCE_OPEN_EVENT, resolve, { once: true }));
    const sourceBuffer = mediaSource.addSourceBuffer(OUTPUT_MIME_TYPES[DEFAULT_OUTPUT_FORMAT]);
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

  async function speak({ text, voice, prosody, source }: PlayerSpeakRequest) {
    release();
    const controller = new AbortController();
    session = controller;
    setState({
      ...IDLE_STATE,
      status: PlayerStatus.Loading,
      text,
      voice,
      source
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

      release();
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

  // Playback interrupted again before it starts rejects, which is nothing to report - play() returns a
  // promise, and beyond NotAllowedError and NotSupportedError "other exceptions may be reported,
  // depending on browser implementation details"
  // https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/play
  async function resume() {
    if (state.status !== PlayerStatus.Paused) {
      return;
    }

    await elAudio.play().catch(ignoreError);
  }

  // "playing" is "fired after playback is first started, and whenever it is restarted", including after
  // a stall for data, so it is the real transition out of loading or paused; "ended" fires when
  // "playback or streaming has stopped because the end of the media was reached"
  // https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/playing_event
  // https://developer.mozilla.org/docs/Web/API/HTMLMediaElement/ended_event
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
