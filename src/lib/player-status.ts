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

export const IDLE_STATE: SpeakingState = {
  status: PlayerStatus.Idle,
  text: "",
  word: null,
  error: null,
  voice: null
};

const READING_STATUSES: ReadonlySet<PlayerStatus> = new Set([
  PlayerStatus.Loading,
  PlayerStatus.Playing,
  PlayerStatus.Paused
]);

export function isReadingStatus(status: PlayerStatus) {
  return READING_STATUSES.has(status);
}
