import { fetchVoices, type Voice } from "@/lib/edge-tts/voice-list";
import { storage } from "wxt/utils/storage";

// Our cache window, not the service's: the list is 322 voices that change between Edge releases, so a
// day saves the round trip without going stale in any way a user would notice
const VOICE_CACHE_MS = 24 * 60 * 60 * 1000;
// The shape FriendlyName actually arrives in from the Read Aloud voice list (the Azure REST reference
// documents the other fields but not this one), measured against the live list:
// "Microsoft Aria Online (Natural) - English (United States)" -> "Aria"
const VOICE_NAME_PREFIX = /^Microsoft /;
const VOICE_NAME_SUFFIX = / Online.*$/;

interface VoiceCache {
  voices: Voice[];
  fetchedAt: number;
}

// Local, not sync: nothing here was chosen by the user, it is only a cache that saves a network round
// trip, and the whole list is far past sync's 102,400 byte quota
// https://developer.chrome.com/docs/extensions/reference/api/storage#property-sync-sync-QUOTA_BYTES
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
