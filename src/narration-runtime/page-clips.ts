import { detectLanguage } from "@/lib/edge-tts/language";
import { type CueTiming, NarrationAttribute, type NarrationClip, parseNarrationScript } from "@/lib/narration";

// A page the narrate CLI never saw has no recording - the spoken text, its language and each cue's text
// position are all a live voice needs
export function readPageClips() {
  const clips: NarrationClip[] = [];
  for (const elCard of document.querySelectorAll<HTMLElement>(`[${NarrationAttribute.Script}]`)) {
    const { text, cues } = parseNarrationScript(elCard.getAttribute(NarrationAttribute.Script) ?? "");
    clips.push({
      audio: "",
      voice: "",
      locale: detectLanguage(text) ?? elCard.closest("[lang]")?.getAttribute("lang") ?? "",
      duration: 0,
      text,
      words: [],
      cues: cues.map((cue): CueTiming => [cue.name, 0, cue.start])
    });
  }

  return clips;
}
