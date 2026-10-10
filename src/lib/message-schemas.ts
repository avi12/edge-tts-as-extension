import { Command } from "@/lib/command";
import { RATE_RANGE } from "@/lib/edge-tts/ssml";
import { z } from "@/lib/zod";

// What a caller may ask for, validated where it arrives. This module is kept apart from the bus in
// messages.ts so that zod only reaches the background - the bridge content script, which imports the
// same bus, ships into every artifact frame

// The one bounded rate: a request's, the stored setting's and the CLI's all read it, so none of them
// can ask for a speed the service would only clamp
export const rateSchema = z.number().min(RATE_RANGE.min).max(RATE_RANGE.max);

// Everything beyond the text is optional - the background fills the rest in from the stored settings
export const speakRequestSchema = z.object({
  text: z.string().default(""),
  voice: z.string().optional(),
  // A rate the service would only clamp is dropped rather than refused, so the reading still happens
  rate: rateSchema.optional().catch(undefined),
  isMatchingLanguage: z.boolean().optional(),
  // The language the text is known to be in, e.g. a narrated card's - a voice that does not speak it is swapped
  locale: z.string().optional()
});

// Every command that is not Speak carries no payload of its own
export const controlCommandSchema = z.enum([
  Command.Stop,
  Command.Pause,
  Command.Resume,
  Command.GetState
]);

export type SpeakRequest = z.infer<typeof speakRequestSchema>;
export type ControlCommand = z.infer<typeof controlCommandSchema>;
