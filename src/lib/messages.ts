import type { Prosody } from "@/lib/edge-tts/ssml";
import type { Voice } from "@/lib/edge-tts/voice-list";
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
  SPEAK = "speak",
  CONTROL = "control",
  PLAYER_SPEAK = "player-speak",
  // Same reading, new voice or speed, carried on from where it has got to
  PLAYER_RESPEAK = "player-respeak",
  PLAYER_CONTROL = "player-control",
  // The player's own state, broadcast to the background and the popup, and relayed to the frame
  // that asked for the reading
  PLAYER_STATE = "player-state",
  LIST_VOICES = "list-voices",
  GET_VOICE = "get-voice",
  SET_VOICE = "set-voice"
}

// Every request is answered with the player's state
interface SpeechProtocolMap {
  [SpeechMessage.SPEAK](request: SpeakRequest): SpeakingState;
  [SpeechMessage.CONTROL](command: ControlCommand): SpeakingState;
  [SpeechMessage.PLAYER_SPEAK](request: PlayerSpeakRequest): SpeakingState;
  [SpeechMessage.PLAYER_RESPEAK](change: PlayerVoiceChange): SpeakingState;
  [SpeechMessage.PLAYER_CONTROL](command: ControlCommand): SpeakingState;
  [SpeechMessage.PLAYER_STATE](state: SpeakingState): void;
  [SpeechMessage.LIST_VOICES](): Voice[];
  [SpeechMessage.GET_VOICE](): string;
  [SpeechMessage.SET_VOICE](voice: string): void;
}

export const speechMessenger = defineExtensionMessaging<SpeechProtocolMap>();
