import type { Prosody } from "@/lib/edge-tts/ssml";
import type { ControlCommand, SpeakRequest } from "@/lib/message-schemas";
import type { ReadingSource, SpeakingState } from "@/lib/player-status";
import { defineExtensionMessaging } from "@webext-core/messaging";

export type { ControlCommand, SpeakRequest };

export interface PlayerSpeakRequest {
  text: string;
  voice: string;
  prosody: Prosody;
  source: ReadingSource;
}

// A voice or speed picked while a reading is in progress, which continues it from the word being
// spoken rather than waiting for the next one
export interface PlayerVoiceChange {
  voice: string;
  prosody: Prosody;
}

// One runtime bus carries both halves of the extension, and the message type is the routing: the
// background answers Speak and Control, the offscreen player answers the Player pair. The strings are
// ours - @webext-core/messaging keys its protocol map by them, so they only have to stay distinct
// https://webext-core.aklinker1.io/messaging/installation
export enum SpeechMessage {
  Speak = "speak",
  Control = "control",
  PlayerSpeak = "player-speak",
  // Same reading, new voice or speed, carried on from where it has got to
  PlayerRespeak = "player-respeak",
  PlayerControl = "player-control",
  // The player's own state, broadcast to the background and the popup, and relayed to the frame
  // that asked for the reading
  PlayerState = "player-state"
}

// Every request is answered with the player's state
interface SpeechProtocolMap {
  [SpeechMessage.Speak](request: SpeakRequest): SpeakingState;
  [SpeechMessage.Control](command: ControlCommand): SpeakingState;
  [SpeechMessage.PlayerSpeak](request: PlayerSpeakRequest): SpeakingState;
  [SpeechMessage.PlayerRespeak](change: PlayerVoiceChange): SpeakingState;
  [SpeechMessage.PlayerControl](command: ControlCommand): SpeakingState;
  [SpeechMessage.PlayerState](state: SpeakingState): void;
}

export const speechMessenger = defineExtensionMessaging<SpeechProtocolMap>();
