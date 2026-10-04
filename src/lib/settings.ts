import { DEFAULT_PROSODY, DEFAULT_VOICE, type Voice } from "@/lib/edge-tts";
import { storage } from "wxt/utils/storage";

export const VOICE_CACHE_MS = 24 * 60 * 60 * 1000;

export interface Settings {
  voice: string;
  rate: number;
}

interface VoiceCache {
  voices: Voice[];
  fetchedAt: number;
}

export const settings = storage.defineItem<Settings>("sync:settings", {
  fallback: {
    voice: DEFAULT_VOICE,
    rate: DEFAULT_PROSODY.rate
  }
});

export const draft = storage.defineItem<string>("local:draft", { fallback: "" });

export const voiceCache = storage.defineItem<VoiceCache | null>("local:voices", { fallback: null });
