import { SpeechMessage, speechMessenger } from "@/lib/messages";
import { NARRATED_SITES } from "@/lib/narrated-sites";
import { NarrationMessage, narrationMessenger } from "@/lib/narration-bridge";

// Every site a narrated page lives on - the list is in lib/narrated-sites.ts. This script carries a
// page's requests to the background and the player's state back, and validates neither: the
// background zod-checks what a page asks for, which keeps zod out of every artifact frame
//
// allFrames because a published artifact renders in a child frame, and the key "defaults to false,
// meaning that only the top frame is matched"
// https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#frames
export default defineContentScript({
  matches: NARRATED_SITES,
  allFrames: true,
  async main() {
    narrationMessenger.onMessage(NarrationMessage.IS_EXTENSION_READY, () => true);
    narrationMessenger.onMessage(NarrationMessage.SPEAK, async ({ data }) => {
      await speechMessenger.sendMessage(SpeechMessage.SPEAK, data);
    });
    narrationMessenger.onMessage(NarrationMessage.CONTROL, async ({ data }) => {
      await speechMessenger.sendMessage(SpeechMessage.CONTROL, data);
    });
    narrationMessenger.onMessage(NarrationMessage.LIST_VOICES, () =>
      speechMessenger.sendMessage(SpeechMessage.LIST_VOICES));
    narrationMessenger.onMessage(NarrationMessage.GET_VOICE, () =>
      speechMessenger.sendMessage(SpeechMessage.GET_VOICE));
    narrationMessenger.onMessage(NarrationMessage.SET_VOICE, ({ data }) =>
      speechMessenger.sendMessage(SpeechMessage.SET_VOICE, data));
    // The page answers only while its runtime listens, and a page without one never answers at all -
    // waiting here would stall the background behind a frame that can never reply
    speechMessenger.onMessage(SpeechMessage.PLAYER_STATE, ({ data }) => {
      void narrationMessenger.sendMessage(NarrationMessage.PLAYER_STATE, data);
    });

    // The background learns where to send the player's state from the request itself, so there is
    // nothing to register here - only the announcement, which a page without a runtime never answers
    await narrationMessenger.sendMessage(NarrationMessage.EXTENSION_READY);
  }
});
