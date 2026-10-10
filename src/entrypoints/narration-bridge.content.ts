import { NARRATED_SITES } from "@/lib/narrated-sites";
import {
  BridgeEvent,
  type BridgeMessage,
  NARRATION_CHANNEL,
  NARRATION_PORT,
  type PageMessage
} from "@/lib/narration-bridge";
import type { SpeakingState } from "@/lib/player-status";

// Only the envelope is checked here: the background zod-validates every request arriving on the port,
// which keeps zod out of this script injected into every artifact frame
function isPageMessage(data: unknown): data is PageMessage {
  return typeof data === "object" && data !== null && "channel" in data && data.channel === NARRATION_CHANNEL;
}

// Every site a narrated page lives on - the list is in lib/narrated-sites.ts
export default defineContentScript({
  matches: NARRATED_SITES,
  allFrames: true,
  main() {
    let port: Browser.runtime.Port | null = null;

    function postToPage(message: BridgeMessage) {
      window.postMessage(message, location.origin === "null" ? "*" : location.origin);
    }

    function connect() {
      if (port) {
        return port;
      }

      const newPort = browser.runtime.connect({ name: NARRATION_PORT });
      newPort.onMessage.addListener((state: SpeakingState) => postToPage({
        channel: NARRATION_CHANNEL,
        event: BridgeEvent.State,
        state
      }));
      newPort.onDisconnect.addListener(() => {
        port = null;
      });
      port = newPort;
      return newPort;
    }

    function announce() {
      postToPage({
        channel: NARRATION_CHANNEL,
        event: BridgeEvent.Ready
      });
    }

    window.addEventListener("message", e => {
      const isFromThisPage = e.source === window;
      if (!isFromThisPage || !isPageMessage(e.data)) {
        return;
      }

      if (e.data.event === BridgeEvent.Hello) {
        announce();
        return;
      }

      connect().postMessage(e.data.request);
    });
    connect();
    announce();
  }
});
