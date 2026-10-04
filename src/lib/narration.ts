// The contract between narrated artifact pages, the narrate CLI and the embedded runtime -
// documented for page authors in the global CLAUDE.md ("Narrate the artifact")

import type { WordBoundary } from "@/lib/edge-tts/protocol";
import { createWordLocator } from "@/lib/edge-tts/words";

export enum NarrationAttribute {
  Script = "data-narrate",
  Title = "data-narrate-title",
  Narrating = "data-narrating",
  Cued = "data-cued"
}

export const NARRATION_DATA_ID = "narration-data";
export const NARRATION_CUE_EVENT = "narration:cue";

const CUE_MARKER = /\[\[([\w-]+)\]\]/g;
const WHITESPACE_RUN = /\s+/g;
const SPACE = " ";

export interface Cue {
  name: string;
  start: number;
}

// Compact tuples keep the embedded JSON small: [seconds, start, length] and [name, seconds]
export type WordTiming = [number, number, number];
export type CueTiming = [string, number];

export interface NarrationClip {
  audio: string;
  duration: number;
  text: string;
  words: WordTiming[];
  cues: CueTiming[];
}

export interface NarrationData {
  voice: string;
  clips: NarrationClip[];
}

function appendSpokenPart({ spoken, part }: {
  spoken: string;
  part: string;
}) {
  const normalized = part.replace(WHITESPACE_RUN, SPACE);
  const isDoubleSpace = spoken.endsWith(SPACE) && normalized.startsWith(SPACE);
  const isLeadingSpace = spoken === "" && normalized.startsWith(SPACE);
  return spoken + (isDoubleSpace || isLeadingSpace ? normalized.slice(1) : normalized);
}

export function parseNarrationScript(script: string) {
  const cues: Cue[] = [];
  let spoken = "";
  let iPartStart = 0;
  for (const match of script.matchAll(CUE_MARKER)) {
    spoken = appendSpokenPart({
      spoken,
      part: script.slice(iPartStart, match.index)
    });
    cues.push({
      name: match[1] ?? "",
      start: spoken.length
    });
    iPartStart = match.index + match[0].length;
  }

  spoken = appendSpokenPart({
    spoken,
    part: script.slice(iPartStart)
  });
  return {
    text: spoken.trimEnd(),
    cues
  };
}

const TIMING_PRECISION = 1000;

function roundTime(seconds: number) {
  return Math.round(seconds * TIMING_PRECISION) / TIMING_PRECISION;
}

export function timeNarration({ text, cues, boundaries, duration }: {
  text: string;
  cues: Cue[];
  boundaries: WordBoundary[];
  duration: number;
}) {
  const locateWord = createWordLocator({ text });
  const words: WordTiming[] = [];
  for (const boundary of boundaries) {
    const iWord = locateWord(boundary.text);
    if (iWord !== null) {
      words.push([roundTime(boundary.time), iWord, boundary.text.length]);
    }
  }

  const cueTimes: CueTiming[] = [];
  for (const cue of cues) {
    const firstWordAfterCue = words.find(([, iWord]) => iWord >= cue.start);
    cueTimes.push([cue.name, firstWordAfterCue?.[0] ?? roundTime(duration)]);
  }

  return {
    words,
    cues: cueTimes
  };
}
