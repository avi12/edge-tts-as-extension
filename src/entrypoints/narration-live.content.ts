import { NARRATED_SITES } from "@/lib/narrated-sites";
import { NARRATION_DATA_ID, NarrationAttribute } from "@/lib/narration";
import { readPageClips } from "@/narration-runtime/page-clips";
import { startNarration } from "@/narration-runtime/start-narration";

const NARRATED_CARD_SELECTOR = `[${NarrationAttribute.Script}]`;

// Pages written with data-narrate scripts but never run through the narrate CLI - an artifact a chat just
// wrote - speak live through the extension. A pre-rendered page brings its own runtime, so it is left alone
export default defineContentScript({
  matches: NARRATED_SITES,
  allFrames: true,
  world: "MAIN",
  main() {
    function startWhenNarrated() {
      const isPreRendered = document.getElementById(NARRATION_DATA_ID) !== null;
      const hasNarratedCards = document.querySelector(NARRATED_CARD_SELECTOR) !== null;
      if (isPreRendered || !hasNarratedCards) {
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
