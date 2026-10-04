// The one message contract between popup, background, offscreen player and
// other extensions.

import type { Prosody } from './edge-tts';

export const Command = {
  Speak: 'speak',
  Stop: 'stop',
  Pause: 'pause',
  Resume: 'resume',
  GetState: 'get-state',
} as const;

/** Broadcast by the player whenever its state changes. */
export const STATE_EVENT = 'state';

/** Marks messages meant for the offscreen player, not the background. */
export const OFFSCREEN_TARGET = 'offscreen';

export type SpeakRequest = {
  type: typeof Command.Speak;
  text: string;
  /** Falls back to the saved setting. */
  voice?: string;
  /** Falls back to the saved setting. */
  rate?: number;
};

export type Request =
  | SpeakRequest
  | { type: Exclude<(typeof Command)[keyof typeof Command], 'speak'> };

/** What the player receives: fully resolved, no fallbacks left. */
export type PlayerRequest =
  | { type: typeof Command.Speak; text: string; voice: string; prosody: Prosody }
  | { type: Exclude<(typeof Command)[keyof typeof Command], 'speak'> };

export const PlayerStatus = {
  Idle: 'idle',
  Loading: 'loading',
  Playing: 'playing',
  Paused: 'paused',
  Error: 'error',
} as const;

export interface PlayerState {
  status: (typeof PlayerStatus)[keyof typeof PlayerStatus];
  text: string;
  /** The word being spoken, as a range in `text`. */
  word: { start: number; length: number } | null;
  error: string | null;
}

export const IDLE_STATE: PlayerState = {
  status: PlayerStatus.Idle,
  text: '',
  word: null,
  error: null,
};

export type StateEvent = { type: typeof STATE_EVENT; state: PlayerState };
