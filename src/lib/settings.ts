import { DEFAULT_VOICE } from "@/lib/edge-tts/constants";
import { DEFAULT_PROSODY } from "@/lib/edge-tts/ssml";
import { rateSchema } from "@/lib/message-schemas";
import { z } from "@/lib/zod";
import { storage } from "wxt/utils/storage";

// Each field falls back on its own, so settings stored before a field existed still load
const settingsSchema = z.object({
  voice: z.string().catch(DEFAULT_VOICE),
  rate: rateSchema.catch(DEFAULT_PROSODY.rate),
  isMatchingLanguage: z.boolean().catch(false)
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS = settingsSchema.parse({});

const settingsItem = storage.defineItem<Partial<Settings>>("sync:settings", {
  fallback: {}
});

export const draft = storage.defineItem<string>("local:draft", { fallback: "" });

export async function readSettings() {
  const parsed = settingsSchema.safeParse(await settingsItem.getValue());
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(value: Settings) {
  await settingsItem.setValue(value);
}
