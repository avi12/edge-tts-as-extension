import type { NarrationEngine, ReportState } from "./engine";
import { Command } from "@/lib/command";
import type { Request } from "@/lib/messages";
import { BridgeEvent, type BridgeMessage, NARRATION_CHANNEL, type PageMessage } from "@/lib/narration-bridge";
import { isReadingStatus, PlayerStatus, type SpeakingState } from "@/lib/player-status";

// Same window on both ends, and an artifact frame's sandboxed origin is "null"
const ANY_ORIGIN = "*";

function postToBridge(message: PageMessage) {
  window.postMessage(message, ANY_ORIGIN);
}

function sendRequest(request: Request) {
  postToBridge({
    channel: NARRATION_CHANNEL,
    event: BridgeEvent.Request,
    request
  });
}

function isBridgeMessage(data: unknown): data is BridgeMessage {
  const isFromBridge = typeof data === "object" && data !== null && "channel" in data && data.channel === NARRATION_CHANNEL;
  return isFromBridge && "event" in data && (data.event === BridgeEvent.Ready || data.event === BridgeEvent.State);
}

// Speaks through the Edge Read Aloud extension when it is installed, in the voice picked in its popup
export function createLiveEngine(reportState: ReportState) {
  let isAvailable = false;
  let speakingText: string | null = null;
  // Late states for a card this page already left are not a takeover
  const sentTexts = new Set<string>();

  function followPlayer(state: SpeakingState) {
    if (speakingText === null) {
      return;
    }

    if (state.text === speakingText) {
      reportState(state);
      return;
    }

    // Someone else took the player over (the popup, another page), or stopped it
    const isPlayerBusyOrStopped = isReadingStatus(state.status) || state.status === PlayerStatus.Idle;
    const isTakenOver = !sentTexts.has(state.text) && isPlayerBusyOrStopped;
    if (isTakenOver) {
      speakingText = null;
      reportState({
        ...state,
        status: PlayerStatus.Idle
      });
    }
  }

  window.addEventListener("message", e => {
    if (e.source !== window || !isBridgeMessage(e.data)) {
      return;
    }

    if (e.data.event === BridgeEvent.Ready) {
      isAvailable = true;
      return;
    }

    followPlayer(e.data.state);
  });
  postToBridge({
    channel: NARRATION_CHANNEL,
    event: BridgeEvent.Hello
  });

  const engine: NarrationEngine = {
    async play(clip) {
      speakingText = clip.text;
      sentTexts.add(clip.text);
      reportState({
        status: PlayerStatus.Loading,
        text: clip.text,
        word: null,
        error: null,
        voice: null
      });
      sendRequest({
        type: Command.Speak,
        text: clip.text,
        locale: clip.locale
      });
    },
    pause() {
      sendRequest({ type: Command.Pause });
    },
    async resume() {
      sendRequest({ type: Command.Resume });
    },
    stop() {
      if (speakingText === null) {
        return;
      }

      speakingText = null;
      sendRequest({ type: Command.Stop });
    }
  };
  return {
    ...engine,
    isAvailable: () => isAvailable
  };
}
