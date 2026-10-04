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

export const IDLE_STATE: PlayerState = {
  status: PlayerStatus.Idle,
  text: "",
  word: null,
  error: null
};

const READING_STATUSES: ReadonlySet<PlayerStatus> = new Set([
  PlayerStatus.Loading,
  PlayerStatus.Playing,
  PlayerStatus.Paused
]);

export function isReadingStatus(status: PlayerStatus) {
  return READING_STATUSES.has(status);
}
