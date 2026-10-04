// The window.postMessage protocol between a narrated page and the extension's bridge content script.
// Zod-free - the page side ships inside every artifact; the bridge validates what it receives
import type { Request } from "@/lib/messages";
import type { SpeakingState } from "@/lib/player-status";

export const NARRATION_CHANNEL = "edge-read-aloud:narration";
export const NARRATION_PORT = "narration";

export enum BridgeEvent {
  Hello = "hello",
  Request = "request",
  Ready = "ready",
  State = "state"
}

export type PageMessage = {
  channel: typeof NARRATION_CHANNEL;
  event: BridgeEvent.Hello;
} | {
  channel: typeof NARRATION_CHANNEL;
  event: BridgeEvent.Request;
  request: Request;
};

export type BridgeMessage = {
  channel: typeof NARRATION_CHANNEL;
  event: BridgeEvent.Ready;
} | {
  channel: typeof NARRATION_CHANNEL;
  event: BridgeEvent.State;
  state: SpeakingState;
};
