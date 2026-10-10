// The contract between narrated artifact pages, the narrate CLI and the embedded runtime -
// documented for page authors in README.md ("Narrated artifacts")

import { detectLanguage } from "@/lib/edge-tts/language";
import type { WordBoundary } from "@/lib/edge-tts/protocol";
import { sanitizeText } from "@/lib/edge-tts/ssml";
import { createWordLocator } from "@/lib/edge-tts/words";

export enum NarrationAttribute {
  Script = "data-narrate",
  Title = "data-narrate-title",
  Voice = "data-narrate-voice",
  Narrating = "data-narrating",
  Cued = "data-cued",
  Cue = "data-cue",
  CueReached = "data-cue-reached"
}

// A card declares a language only where it says so itself: the writing system of its script, or a lang
// attribute that is not simply the page's own. A card that declares nothing is read by the voice the
// listener picked, whatever language that voice speaks
export function getDeclaredLanguage({ text, cardLanguage, rootLanguage }: {
  text: string;
  cardLanguage: string | null;
  rootLanguage: string | null;
}) {
  const isPageLanguage = cardLanguage === rootLanguage;
  return detectLanguage(text) ?? (isPageLanguage ? null : cardLanguage);
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

// Compact tuples keep the embedded JSON small: [seconds, start, length] and [name, seconds, start] -
// a cue's text position lets a live voice, which reports words rather than time, drive it too
export type WordTiming = [number, number, number];
export type CueTiming = [string, number, number];

export interface NarrationClip {
  audio: string;
  voice: string;
  // The voice's locale, so subtitles render in the right language and direction
  locale: string;
  // What the card asks a live voice for: a pinned voice reads as itself, a declared language (a
  // non-Latin script or a lang attribute) is read by any voice that speaks it, and a card that
  // declares neither is read by the voice picked in the extension's popup, whatever its language
  pinnedVoice: string | null;
  declaredLanguage: string | null;
  duration: number;
  text: string;
  words: WordTiming[];
  cues: CueTiming[];
}

export interface NarrationData {
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
  // Boundaries spell words as they were sent, with straightened quotes - same length, so indexes carry over
  const locateWord = createWordLocator({ text: sanitizeText(text) });
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
    cueTimes.push([cue.name, firstWordAfterCue?.[0] ?? roundTime(duration), cue.start]);
  }

  return {
    words,
    cues: cueTimes
  };
}
