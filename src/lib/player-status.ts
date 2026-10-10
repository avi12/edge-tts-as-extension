// Our own vocabulary for what a reading is doing, not the media element's readyState or network state:
// only the offscreen player sees those, and Loading covers waiting for the first bytes off the socket
export enum PlayerStatus {
  Idle = "idle",
  Loading = "loading",
  Playing = "playing",
  Paused = "paused",
  Finished = "finished",
  Error = "error"
}

export interface SpokenWord {
  start: number;
  length: number;
}

export interface PlayerState {
  status: PlayerStatus;
  text: string;
  word: SpokenWord | null;
  error: string | null;
}

// The extension's player also says which voice reads - with language matching on, not always the one picked
export interface SpeakingState extends PlayerState {
  voice: string | null;
}

// Ours: the state a player starts in and returns to, and the answer every caller gets when there is
// nothing to say - so no reader has to handle a missing state
export const IDLE_STATE: SpeakingState = {
  status: PlayerStatus.Idle,
  text: "",
  word: null,
  error: null,
  voice: null
};

// Ours: the three statuses that mean a reading is in flight, so the popup and the narration runtime
// treat them alike instead of each listing them
const READING_STATUSES: ReadonlySet<PlayerStatus> = new Set([
  PlayerStatus.Loading,
  PlayerStatus.Playing,
  PlayerStatus.Paused
]);

export function isReadingStatus(status: PlayerStatus) {
  return READING_STATUSES.has(status);
}
