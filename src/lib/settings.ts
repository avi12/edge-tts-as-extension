import { DEFAULT_VOICE } from "@/lib/edge-tts/constants";
import { DEFAULT_PROSODY } from "@/lib/edge-tts/ssml";
import { rateSchema } from "@/lib/message-schemas";
import { z } from "@/lib/zod";
import { storage } from "wxt/utils/storage";

// Each field falls back on its own, so settings stored before a field existed still load. Two of the
// fallbacks come from lib/edge-tts (the default voice and the neutral prosody rate); language matching
// starts off because it is ours to offer, not the service's behaviour
const settingsSchema = z.object({
  voice: z.string().catch(DEFAULT_VOICE),
  rate: rateSchema.catch(DEFAULT_PROSODY.rate),
  isMatchingLanguage: z.boolean().catch(false)
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS = settingsSchema.parse({});

// The key names are ours; the "sync:" and "local:" prefixes are WXT's, where "all storage keys must be
// prefixed by their storage area". What the user chose follows them between signed-in browsers, because
// sync "syncs with every Chrome browser that the user is logged into. If disabled, it behaves like
// storage.local"
// https://wxt.dev/storage.html
// https://developer.chrome.com/docs/extensions/reference/api/storage#property-sync
const settingsItem = storage.defineItem<Partial<Settings>>("sync:settings", {
  fallback: {}
});

// The popup's unsent text is local on purpose: it belongs to this browser, and sync caps an item at
// 8,192 bytes, which a paste would blow past
// https://developer.chrome.com/docs/extensions/reference/api/storage#property-sync-sync-QUOTA_BYTES_PER_ITEM
export const draft = storage.defineItem<string>("local:draft", { fallback: "" });

export async function readSettings() {
  const parsed = settingsSchema.safeParse(await settingsItem.getValue());
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(value: Settings) {
  await settingsItem.setValue(value);
}

// Fires wherever the settings were changed from, which is how a reading already in progress hears
// about a voice picked in the popup. The callback may be async: storage listeners are a platform
// boundary that awaits nothing, so the awaiting ends here
export function watchSettings(onChange: () => Promise<void>) {
  return settingsItem.watch(onChange);
}
