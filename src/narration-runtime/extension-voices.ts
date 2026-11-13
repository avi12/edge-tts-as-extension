import { NarrationMessage, narrationMessenger } from "@/lib/narration-bridge";

// The voice list and the picked voice, kept by the extension. A page with the extension installed offers
// them in its panel; a page without it is never answered, so these promises simply never settle
export const extensionVoices = {
  listVoices: () => narrationMessenger.sendMessage(NarrationMessage.LIST_VOICES),
  getVoice: () => narrationMessenger.sendMessage(NarrationMessage.GET_VOICE),
  setVoice: (voice: string) => narrationMessenger.sendMessage(NarrationMessage.SET_VOICE, voice)
};
