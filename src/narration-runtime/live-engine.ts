import type { NarrationEngine, ReportState } from "./engine";
import { Command } from "@/lib/command";
import { NarrationMessage, narrationMessenger } from "@/lib/narration-bridge";
import { isReadingStatus, PlayerStatus, type SpeakingState } from "@/lib/player-status";

// Speaks through the Edge Read Aloud extension when it is installed, in the voice picked in its popup
export function createLiveEngine(reportState: ReportState) {
  let isAvailable = false;
  let speakingText: string | null = null;
  let fullText = "";
  let locale = "";
  // The player cannot seek, so a jump re-speaks the text from that word and positions are shifted back
  let spokenOffset = 0;
  // Late states for a card this page already left are not a takeover
  const sentTexts = new Set<string>();

  function followPlayer(state: SpeakingState) {
    if (speakingText === null) {
      return;
    }

    if (state.text === speakingText) {
      reportState({
        ...state,
        text: fullText,
        word: state.word && {
          start: state.word.start + spokenOffset,
          length: state.word.length
        }
      });
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

  // The bridge announces itself for a runtime that was already listening; a runtime that started
  // later asks instead, and a page with no extension is simply never answered - the one send that
  // cannot be awaited, since nothing settles it
  narrationMessenger.onMessage(NarrationMessage.ExtensionReady, () => {
    isAvailable = true;
  });
  narrationMessenger.onMessage(NarrationMessage.PlayerState, ({ data }) => followPlayer(data));
  void narrationMessenger.sendMessage(NarrationMessage.IsExtensionReady).then(() => {
    isAvailable = true;
  });

  async function speakFrom(start: number) {
    spokenOffset = start;
    speakingText = fullText.slice(start);
    sentTexts.add(speakingText);
    await narrationMessenger.sendMessage(NarrationMessage.Speak, {
      text: speakingText,
      locale
    });
  }

  const engine: NarrationEngine = {
    async play(clip) {
      fullText = clip.text;
      locale = clip.locale;
      reportState({
        status: PlayerStatus.Loading,
        text: clip.text,
        word: null,
        error: null,
        voice: null
      });
      await speakFrom(0);
    },
    async seek(start) {
      if (speakingText === null) {
        return;
      }

      await speakFrom(start);
    },
    async pause() {
      await narrationMessenger.sendMessage(NarrationMessage.Control, Command.Pause);
    },
    async resume() {
      await narrationMessenger.sendMessage(NarrationMessage.Control, Command.Resume);
    },
    async stop() {
      if (speakingText === null) {
        return;
      }

      speakingText = null;
      await narrationMessenger.sendMessage(NarrationMessage.Control, Command.Stop);
    }
  };
  return {
    ...engine,
    isAvailable: () => isAvailable
  };
}
