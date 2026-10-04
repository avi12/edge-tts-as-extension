import { requestSchema } from "@/lib/messages";
import { BridgeEvent, type BridgeMessage, NARRATION_CHANNEL, NARRATION_PORT } from "@/lib/narration-bridge";
import type { SpeakingState } from "@/lib/player-status";
import { z } from "@/lib/zod";

const pageMessageSchema = z.discriminatedUnion("event", [
  z.object({
    channel: z.literal(NARRATION_CHANNEL),
    event: z.literal(BridgeEvent.Hello)
  }),
  z.object({
    channel: z.literal(NARRATION_CHANNEL),
    event: z.literal(BridgeEvent.Request),
    request: requestSchema
  })
]);

// Claude's artifact frames, plus local previews of narrated pages
export default defineContentScript({
  matches: ["https://*.claudeusercontent.com/*", "http://localhost/*", "http://127.0.0.1/*"],
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
      const parsed = pageMessageSchema.safeParse(e.data);
      if (!isFromThisPage || !parsed.success) {
        return;
      }

      if (parsed.data.event === BridgeEvent.Hello) {
        announce();
        return;
      }

      connect().postMessage(parsed.data.request);
    });
    connect();
    announce();
  }
});
