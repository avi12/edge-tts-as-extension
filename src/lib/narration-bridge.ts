// The channel between a narrated page and the extension's bridge content script. Custom events cross
// the page/extension world boundary, and this module is zod-free: the page side ships inside every
// narrated artifact, and the background validates whatever the page asks for
import type { Voice } from "@/lib/edge-tts/voice-list";
import type { ControlCommand, SpeakRequest } from "@/lib/messages";
import type { SpeakingState } from "@/lib/player-status";
import { defineCustomEventMessaging } from "@webext-core/messaging/page";

// Ours, named after the extension so it cannot collide with another custom event on a page it shares:
// "only messengers of the same type (window vs custom event) and same namespace will communicate"
// https://webext-core.aklinker1.io/messaging/installation
const NARRATION_NAMESPACE = "edge-read-aloud:narration";

// Ours, like the extension bus's keys: the library routes on them, so they only have to stay distinct
export enum NarrationMessage {
  // The bridge announcing itself, for a page whose runtime was already listening
  EXTENSION_READY = "extension-ready",
  // The page asking whether the bridge is there, for a runtime that started after it
  IS_EXTENSION_READY = "is-extension-ready",
  SPEAK = "speak",
  CONTROL = "control",
  PLAYER_STATE = "player-state",
  // The voice list and the picked voice, so a narrated page can offer a dropdown without a host of its own
  LIST_VOICES = "list-voices",
  GET_VOICE = "get-voice",
  SET_VOICE = "set-voice"
}

interface NarrationProtocolMap {
  [NarrationMessage.EXTENSION_READY](): void;
  [NarrationMessage.IS_EXTENSION_READY](): boolean;
  [NarrationMessage.SPEAK](request: SpeakRequest): void;
  [NarrationMessage.CONTROL](command: ControlCommand): void;
  [NarrationMessage.PLAYER_STATE](state: SpeakingState): void;
  [NarrationMessage.LIST_VOICES](): Voice[];
  [NarrationMessage.GET_VOICE](): string;
  [NarrationMessage.SET_VOICE](voice: string): void;
}

export const narrationMessenger = defineCustomEventMessaging<NarrationProtocolMap>({ namespace: NARRATION_NAMESPACE });
