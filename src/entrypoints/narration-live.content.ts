import { NARRATED_SITES } from "@/lib/narrated-sites";
import { NARRATION_DATA_ID, NarrationAttribute } from "@/lib/narration";
import { readPageClips } from "@/narration-runtime/page-clips";
import { startNarration } from "@/narration-runtime/start-narration";

// Built from our own narration contract's attribute name, which lives in lib/narration.ts
const NARRATED_CARD_SELECTOR = `[${NarrationAttribute.Script}]`;

// Pages written with data-narrate scripts but never run through the narrate CLI - an artifact a chat just
// wrote - speak live through the extension. A pre-rendered page brings its own runtime, so it is left alone
//
// world MAIN because "the script will share the execution environment with the host page's JavaScript",
// which is what running the narration runtime against the page's own DOM and globals needs; the default
// is ISOLATED. allFrames for the same reason as the bridge: artifacts render in a child frame
// https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#world-timings
// https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts#frames
export default defineContentScript({
  matches: NARRATED_SITES,
  allFrames: true,
  world: "MAIN",
  main() {
    function startWhenNarrated() {
      const isPreRendered = document.getElementById(NARRATION_DATA_ID) !== null;
      const isAnyCardNarrated = document.querySelector(NARRATED_CARD_SELECTOR) !== null;
      if (isPreRendered || !isAnyCardNarrated) {
        return isPreRendered;
      }

      startNarration({ clips: readPageClips() });
      return true;
    }

    if (startWhenNarrated()) {
      return;
    }

    // Artifact frames can render their content after the document loads
    const observer = new MutationObserver(() => {
      if (startWhenNarrated()) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
});
