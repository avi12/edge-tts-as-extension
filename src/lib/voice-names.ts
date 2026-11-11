import type { Voice } from "@/lib/edge-tts/voice-list";

// The shape FriendlyName actually arrives in from the Read Aloud voice list (the Azure REST reference
// documents the other fields but not this one), measured against the live list:
// "Microsoft Aria Online (Natural) - English (United States)" -> "Aria"
const VOICE_NAME_PREFIX = /^Microsoft /;
const VOICE_NAME_SUFFIX = / Online.*$/;
// The service glues the word onto the name: "EmmaMultilingual"
const MULTILINGUAL_SUFFIX = /(?<=\p{Ll})Multilingual$/u;

export function getVoiceName(voice: Voice) {
  return voice.FriendlyName
    .replace(VOICE_NAME_PREFIX, "")
    .replace(VOICE_NAME_SUFFIX, "")
    .replace(MULTILINGUAL_SUFFIX, " (Multilingual)");
}

export function getVoiceLabel(voice: Voice) {
  return `${voice.LocaleName} · ${getVoiceName(voice)} · ${voice.Gender}`;
}

export function groupVoicesByLocale(voices: Voice[]) {
  const sortedVoices = voices.toSorted((left, right) => left.LocaleName.localeCompare(right.LocaleName));
  return Map.groupBy(sortedVoices, voice => voice.Locale)
    .entries()
    .map(([locale, localeVoices]) => ({
      locale,
      label: localeVoices[0]?.LocaleName ?? locale,
      voices: localeVoices
    }))
    .toArray();
}
