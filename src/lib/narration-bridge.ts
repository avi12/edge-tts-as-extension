// The channel between a narrated page and the extension's bridge content script. Custom events cross
// the page/extension world boundary, and this module is zod-free: the page side ships inside every
// narrated artifact, and the background validates whatever the page asks for
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
  ExtensionReady = "extension-ready",
  // The page asking whether the bridge is there, for a runtime that started after it
  IsExtensionReady = "is-extension-ready",
  Speak = "speak",
  Control = "control",
  PlayerState = "player-state"
}

interface NarrationProtocolMap {
  [NarrationMessage.ExtensionReady](): void;
  [NarrationMessage.IsExtensionReady](): boolean;
  [NarrationMessage.Speak](request: SpeakRequest): void;
  [NarrationMessage.Control](command: ControlCommand): void;
  [NarrationMessage.PlayerState](state: SpeakingState): void;
}

export const narrationMessenger = defineCustomEventMessaging<NarrationProtocolMap>({ namespace: NARRATION_NAMESPACE });
