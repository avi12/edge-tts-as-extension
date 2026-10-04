import { fetchVoices, type Voice } from "@/lib/edge-tts/client";
import { storage } from "wxt/utils/storage";

const VOICE_CACHE_MS = 24 * 60 * 60 * 1000;
// "Microsoft Aria Online (Natural) - English (United States)" -> "Aria"
const VOICE_NAME_PREFIX = /^Microsoft /;
const VOICE_NAME_SUFFIX = / Online.*$/;

interface VoiceCache {
  voices: Voice[];
  fetchedAt: number;
}

const voiceCache = storage.defineItem<VoiceCache | null>("local:voices", { fallback: null });

export async function loadVoices() {
  const cached = await voiceCache.getValue();
  const isCacheFresh = cached !== null && Date.now() - cached.fetchedAt < VOICE_CACHE_MS;
  if (isCacheFresh) {
    return cached.voices;
  }

  const voices = await fetchVoices();
  await voiceCache.setValue({
    voices,
    fetchedAt: Date.now()
  });
  return voices;
}

export function getVoiceName(voice: Voice) {
  return voice.FriendlyName.replace(VOICE_NAME_PREFIX, "").replace(VOICE_NAME_SUFFIX, "");
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
