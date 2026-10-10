import { Command } from "@/lib/command";
import { z } from "@/lib/zod";

// What a caller may ask for, validated where it arrives. This module is kept apart from the bus in
// messages.ts so that zod only reaches the background - the bridge content script, which imports the
// same bus, ships into every artifact frame

// Everything beyond the text is optional - the background fills the rest in from the stored settings
export const speakRequestSchema = z.object({
  text: z.string().default(""),
  voice: z.string().optional(),
  rate: z.number().optional(),
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
