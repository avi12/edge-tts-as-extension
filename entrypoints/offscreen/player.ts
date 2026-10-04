import {
  AUDIO_MIME,
  chunkText,
  sanitizeText,
  synthesize,
  type Prosody,
} from '@/lib/edge-tts';
import { IDLE_STATE, PlayerStatus, type PlayerState } from '@/lib/messages';

/** How often the spoken word is re-checked against the audio clock. */
const WORD_TICK_MS = 50;
/** Played audio kept in the buffer when it fills up on very long text. */
const KEEP_BEHIND_S = 10;

interface TimedWord {
  /** Seconds on the audio element's timeline. */
  time: number;
  start: number;
  length: number;
}

/**
 * Plays text the way Edge does: streams WebM/Opus from the service straight
 * into a MediaSource, so speech starts before the whole text is synthesized.
 * Long text is split into several requests; the SourceBuffer runs in
 * "sequence" mode so each request's audio lands right after the previous one.
 */
export class Player {
  private audio = new Audio();
  private state: PlayerState = IDLE_STATE;
  private session: AbortController | null = null;
  private words: TimedWord[] = [];
  private ticker = 0;

  constructor(private onChange: (state: PlayerState) => void) {
    this.audio.onplaying = () => this.set({ status: PlayerStatus.Playing });
    this.audio.onended = () => this.finish();
  }

  getState() {
    return this.state;
  }

  async speak(text: string, voice: string, prosody: Prosody) {
    this.stop();
    const session = new AbortController();
    this.session = session;
    this.set({ ...IDLE_STATE, status: PlayerStatus.Loading, text });

    try {
      const source = new MediaSource();
      this.audio.src = URL.createObjectURL(source);
      await new Promise((r) => source.addEventListener('sourceopen', r, { once: true }));
      const buffer = source.addSourceBuffer(AUDIO_MIME);
      buffer.mode = 'sequence';
      const append = this.appender(buffer, session.signal);

      const spoken = sanitizeText(text);
      for (const chunk of chunkText(text)) {
        let chunkStart: number | null = null;
        let cursor = chunk.start;
        const pending: { time: number; text: string }[] = [];
        const place = (w: { time: number; text: string }) => {
          const at = spoken.indexOf(w.text, cursor);
          if (at < 0) return;
          cursor = at + w.text.length;
          this.words.push({ time: chunkStart! + w.time, start: at, length: w.text.length });
        };

        await synthesize(chunk.text, voice, prosody, {
          signal: session.signal,
          onAudio: (bytes) =>
            append(bytes).then((startedAt) => {
              if (chunkStart !== null) return;
              chunkStart = startedAt;
              pending.splice(0).forEach(place);
              if (this.audio.paused && this.state.status === PlayerStatus.Loading) {
                this.audio.play().catch(() => {});
              }
            }, () => {}), // A failed append surfaces through drained() below.
          // Boundaries can arrive before this chunk's audio has a place on the timeline.
          onWordBoundary: (w) => (chunkStart === null ? pending.push(w) : place(w)),
        });
      }
      await append.drained();
      if (!session.signal.aborted) source.endOfStream();
      this.startTicker();
    } catch (error) {
      if (session.signal.aborted) return;
      this.stop();
      this.set({ ...IDLE_STATE, status: PlayerStatus.Error, text, error: String((error as Error)?.message ?? error) });
    }
  }

  pause() {
    if (this.state.status !== PlayerStatus.Playing) return;
    this.audio.pause();
    this.set({ status: PlayerStatus.Paused });
  }

  resume() {
    if (this.state.status !== PlayerStatus.Paused) return;
    this.audio.play();
  }

  stop() {
    this.session?.abort();
    this.session = null;
    this.audio.pause();
    if (this.audio.src) URL.revokeObjectURL(this.audio.src);
    this.audio.removeAttribute('src');
    this.words = [];
    clearInterval(this.ticker);
    this.ticker = 0;
    if (this.state.status !== PlayerStatus.Idle) this.set(IDLE_STATE);
  }

  private finish() {
    const { text } = this.state;
    this.stop();
    this.set({ ...IDLE_STATE, text });
  }

  /**
   * Serializes appendBuffer calls (a SourceBuffer takes one at a time).
   * Each call resolves with the timeline position where its bytes began.
   */
  private appender(buffer: SourceBuffer, signal: AbortSignal) {
    let queue = Promise.resolve(0);
    const updated = () =>
      new Promise((r) => buffer.addEventListener('updateend', r, { once: true }));
    const end = () => (buffer.buffered.length ? buffer.buffered.end(buffer.buffered.length - 1) : 0);

    const appendOnce = async (bytes: Uint8Array<ArrayBuffer>): Promise<number> => {
      if (signal.aborted) return end();
      const startedAt = end();
      try {
        buffer.appendBuffer(bytes);
      } catch (error) {
        if ((error as DOMException).name !== 'QuotaExceededError') throw error;
        // Very long text: drop audio that has already been played, then retry.
        const played = this.audio.currentTime - KEEP_BEHIND_S;
        if (played <= 0) await new Promise((r) => setTimeout(r, 1000));
        else {
          buffer.remove(0, played);
          await updated();
        }
        return appendOnce(bytes);
      }
      await updated();
      this.startTicker();
      return startedAt;
    };

    const append = (bytes: Uint8Array<ArrayBuffer>) => (queue = queue.then(() => appendOnce(bytes)));
    append.drained = () => queue;
    return append;
  }

  /** Follows the audio clock and reports the word being spoken. */
  private startTicker() {
    if (this.ticker) return;
    this.ticker = window.setInterval(() => {
      const now = this.audio.currentTime;
      let current: TimedWord | undefined;
      for (const w of this.words) {
        if (w.time > now) break;
        current = w;
      }
      const word = current ? { start: current.start, length: current.length } : null;
      if (word?.start !== this.state.word?.start) this.set({ word });
    }, WORD_TICK_MS);
  }

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}
