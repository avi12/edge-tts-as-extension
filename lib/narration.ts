// The contract between artifact pages and the narrator - documented for page authors in the
// global CLAUDE.md ("Narrate artifacts for the Edge Read Aloud extension")

export enum NarrationAttribute {
  Script = "data-narrate",
  Title = "data-narrate-title",
  Narrating = "data-narrating",
  Cued = "data-cued"
}

export const NARRATION_MESSAGE_SOURCE = "edge-read-aloud";
export const NARRATION_MESSAGE_TYPE = "narration";

const CUE_MARKER = /\[\[([\w-]+)\]\]/g;
const WHITESPACE_RUN = /\s+/g;
const SPACE = " ";

export interface Cue {
  name: string;
  start: number;
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

export function getReachedCueNames({ cues, iSpokenWord }: {
  cues: Cue[];
  iSpokenWord: number;
}) {
  const names = new Set<string>();
  for (const cue of cues) {
    if (cue.start <= iSpokenWord) {
      names.add(cue.name);
    }
  }

  return [...names];
}
