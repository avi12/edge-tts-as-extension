import { SpeechMessage, speechMessenger } from "@/lib/messages";
import { NARRATED_SITES } from "@/lib/narrated-sites";
import { NarrationMessage, narrationMessenger } from "@/lib/narration-bridge";

// Every site a narrated page lives on - the list is in lib/narrated-sites.ts. This script carries a
// page's requests to the background and the player's state back, and validates neither: the
// background zod-checks what a page asks for, which keeps zod out of every artifact frame
export default defineContentScript({
  matches: NARRATED_SITES,
  allFrames: true,
  async main() {
    narrationMessenger.onMessage(NarrationMessage.IsExtensionReady, () => true);
    narrationMessenger.onMessage(NarrationMessage.Speak, async ({ data }) => {
      await speechMessenger.sendMessage(SpeechMessage.Speak, data);
    });
    narrationMessenger.onMessage(NarrationMessage.Control, async ({ data }) => {
      await speechMessenger.sendMessage(SpeechMessage.Control, data);
    });
    // The page answers only while its runtime listens, and a page without one never answers at all -
    // waiting here would stall the background behind a frame that can never reply
    speechMessenger.onMessage(SpeechMessage.PlayerState, ({ data }) => {
      void narrationMessenger.sendMessage(NarrationMessage.PlayerState, data);
    });

    // The background learns where to send the player's state from the request itself, so there is
    // nothing to register here - only the announcement, which a page without a runtime never answers
    await narrationMessenger.sendMessage(NarrationMessage.ExtensionReady);
  }
});
