import type { Prosody } from "@/lib/edge-tts";
import { z } from "@/lib/zod";

export enum Command {
  Speak = "speak",
  Stop = "stop",
  Pause = "pause",
  Resume = "resume",
  GetState = "get-state"
}

export enum PlayerStatus {
  Idle = "idle",
  Loading = "loading",
  Playing = "playing",
  Paused = "paused",
  Error = "error"
}

export const STATE_EVENT = "state";
export const OFFSCREEN_TARGET = "offscreen";

const speakRequestSchema = z.object({
  type: z.literal(Command.Speak),
  text: z.string().default(""),
  voice: z.string().optional(),
  rate: z.number().optional()
});

const controlRequestSchema = z.object({
  type: z.enum([
    Command.Stop,
    Command.Pause,
    Command.Resume,
    Command.GetState
  ])
});

export const requestSchema = z.discriminatedUnion("type", [speakRequestSchema, controlRequestSchema]);

const prosodySchema = z.object({
  rate: z.number(),
  volume: z.number(),
  pitchHz: z.number()
}) satisfies z.ZodType<Prosody>;

const playerRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(Command.Speak),
    text: z.string(),
    voice: z.string(),
    prosody: prosodySchema
  }),
  controlRequestSchema
]);

export const playerTargetSchema = z.object({ target: z.literal(OFFSCREEN_TARGET) });

export const playerMessageSchema = z.intersection(playerRequestSchema, playerTargetSchema);

const playerStateSchema = z.object({
  status: z.enum(PlayerStatus),
  text: z.string(),
  word: z.object({
    start: z.number(),
    length: z.number()
  }).nullable(),
  error: z.string().nullable()
});

export const stateEventSchema = z.object({
  type: z.literal(STATE_EVENT),
  state: playerStateSchema
});

export type Request = z.infer<typeof requestSchema>;
export type SpeakRequest = z.infer<typeof speakRequestSchema>;
export type ControlRequest = z.infer<typeof controlRequestSchema>;
export type PlayerRequest = z.infer<typeof playerRequestSchema>;
export type PlayerState = z.infer<typeof playerStateSchema>;
export type StateEvent = z.infer<typeof stateEventSchema>;

export const IDLE_STATE: PlayerState = {
  status: PlayerStatus.Idle,
  text: "",
  word: null,
  error: null
};
