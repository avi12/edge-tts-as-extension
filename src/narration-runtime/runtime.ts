import { startNarration } from "./start-narration";
import { NARRATION_DATA_ID, type NarrationData } from "@/lib/narration";

function readNarrationData() {
  const json = document.getElementById(NARRATION_DATA_ID)?.textContent;
  if (!json) {
    return null;
  }

  // Written into this same page by the narrate CLI, so it is trusted - zod would add ~300 KB to every artifact
  const data: NarrationData = JSON.parse(json);
  return data;
}

const narrationData = readNarrationData();
if (narrationData) {
  startNarration(narrationData);
}
