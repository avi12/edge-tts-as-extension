import type { NarrationClip } from "@/lib/narration";
import type { SpeakingState } from "@/lib/player-status";

// Speaks one clip at a time and reports every change as the extension player does, so the runtime
// follows a recorded clip and a live voice the same way
export interface NarrationEngine {
  play: (clip: NarrationClip) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  // Jumps to the word at (or after) this position in the clip's text
  seek: (start: number) => Promise<void>;
  stop: () => Promise<void>;
}

export type ReportState = (state: SpeakingState) => void;
