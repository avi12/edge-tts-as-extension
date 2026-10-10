import {
  type CueTiming,
  getDeclaredLanguage,
  NarrationAttribute,
  type NarrationClip,
  parseNarrationScript
} from "@/lib/narration";

// A page the narrate CLI never saw has no recording - the spoken text, its language and each cue's text
// position are all a live voice needs
export function readPageClips() {
  const rootLanguage = document.documentElement.getAttribute("lang");
  const clips: NarrationClip[] = [];
  for (const elCard of document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.Script}]`)) {
    const { text, cues } = parseNarrationScript(elCard.getAttribute(NarrationAttribute.Script) ?? "");
    const declaredLanguage = getDeclaredLanguage({
      text,
      cardLanguage: elCard.closest("[lang]")?.getAttribute("lang") ?? null,
      rootLanguage
    });
    clips.push({
      audio: "",
      voice: "",
      locale: declaredLanguage ?? "",
      pinnedVoice: elCard.getAttribute(NarrationAttribute.Voice),
      declaredLanguage,
      duration: 0,
      text,
      words: [],
      cues: cues.map((cue): CueTiming => [cue.name, 0, cue.start])
    });
  }

  return clips;
}
