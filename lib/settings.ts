import { DEFAULT_VOICE, type Voice } from "@/lib/edge-tts";
import { storage } from "wxt/utils/storage";

export const RATE = {
  min: 0.5,
  max: 2,
  step: 0.1,
  default: 1
};

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
    rate: RATE.default
  }
});

export const draft = storage.defineItem<string>("local:draft", { fallback: "" });

export const voiceCache = storage.defineItem<VoiceCache | null>("local:voices", { fallback: null });
