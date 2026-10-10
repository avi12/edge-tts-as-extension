import type { Prosody } from "@/lib/edge-tts/ssml";
import type { ControlCommand, SpeakRequest } from "@/lib/message-schemas";
import type { SpeakingState } from "@/lib/player-status";
import { defineExtensionMessaging } from "@webext-core/messaging";

export type { ControlCommand, SpeakRequest };

export interface PlayerSpeakRequest {
  text: string;
  voice: string;
  prosody: Prosody;
}

// One runtime bus carries both halves of the extension, and the message type is the routing: the
// background answers Speak and Control, the offscreen player answers the Player pair
export enum SpeechMessage {
  Speak = "speak",
  Control = "control",
  PlayerSpeak = "player-speak",
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
  [SpeechMessage.PlayerControl](command: ControlCommand): SpeakingState;
  [SpeechMessage.PlayerState](state: SpeakingState): void;
}

export const speechMessenger = defineExtensionMessaging<SpeechProtocolMap>();
