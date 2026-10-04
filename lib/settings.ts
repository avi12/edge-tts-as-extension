import { storage } from 'wxt/utils/storage';
import { DEFAULT_VOICE, type Voice } from './edge-tts';

export const RATE = { min: 0.5, max: 2, step: 0.1, default: 1 } as const;

export interface Settings {
  voice: string;
  rate: number;
}

export const settings = storage.defineItem<Settings>('sync:settings', {
  fallback: { voice: DEFAULT_VOICE, rate: RATE.default },
});

/** Last text typed in the popup, so closing it doesn't lose the draft. */
export const draft = storage.defineItem<string>('local:draft', {
  fallback: '',
});

export const VOICE_CACHE_MS = 24 * 60 * 60 * 1000;

export const voiceCache = storage.defineItem<{
  voices: Voice[];
  fetchedAt: number;
} | null>('local:voices', { fallback: null });
