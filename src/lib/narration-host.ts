import type { Voice } from "@/lib/edge-tts/voice-list";
import type { WordTiming } from "@/lib/narration";

// What a page's host records for one card: the parts of a NarrationClip that change with the voice
export interface HostRecording {
  audio: string;
  duration: number;
  words: WordTiming[];
}

// A page that can record clips in any voice - an app that embeds narrated pages and runs the narrate
// tooling beside them - hands the runtime this object before the runtime starts. The runtime then
// offers every voice in its panel and records each card in the one the listener picked; a page
// without it plays only what the narrate CLI embedded. Documented for page authors in README.md
interface NarrationHost {
  listVoices: () => Promise<Voice[]>;
  // The pick is the host's to keep, so it outlives the page
  getVoice: () => Promise<string | null>;
  setVoice: (voice: string) => Promise<void>;
  record: (request: {
    text: string;
    voice: string;
  }) => Promise<HostRecording>;
}

declare global {
  // The name pages hand the host over by - var, since only a var declaration adds to globalThis
  // https://www.typescriptlang.org/docs/handbook/declaration-files/templates/global-modifying-module-d-ts.html
  var narrationHost: NarrationHost | undefined;
}

export function findNarrationHost() {
  return globalThis.narrationHost ?? null;
}
