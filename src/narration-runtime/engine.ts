import type { NarrationClip } from "@/lib/narration";
import type { SpeakingState } from "@/lib/player-status";

// Speaks one clip at a time and reports every change as the extension player does, so the runtime
// follows a recorded clip and a live voice the same way
export interface NarrationEngine {
  play: (clip: NarrationClip) => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  stop: () => void;
}

export type ReportState = (state: SpeakingState) => void;
