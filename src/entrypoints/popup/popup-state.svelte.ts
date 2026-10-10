import { Command } from "@/lib/command";
import type { Voice } from "@/lib/edge-tts/voice-list";
import { getErrorMessage } from "@/lib/errors";
import { type ControlCommand, SpeechMessage, speechMessenger } from "@/lib/messages";
import { IDLE_STATE, type SpeakingState } from "@/lib/player-status";
import {
  DEFAULT_SETTINGS,
  draft,
  readSettings,
  saveSettings,
  type Settings
} from "@/lib/settings";
import { loadVoices } from "@/lib/voices";

interface PopupState {
  text: string;
  voices: Voice[];
  settings: Settings;
  player: SpeakingState;
  error: string | null;
}

export const popup: PopupState = $state({
  text: "",
  voices: [],
  settings: DEFAULT_SETTINGS,
  player: IDLE_STATE,
  error: null
});

export async function speak() {
  popup.player = await speechMessenger.sendMessage(SpeechMessage.Speak, {
    text: popup.text,
    voice: popup.settings.voice,
    rate: popup.settings.rate,
    isMatchingLanguage: popup.settings.isMatchingLanguage
  });
}

export async function control(command: ControlCommand) {
  popup.player = await speechMessenger.sendMessage(SpeechMessage.Control, command);
}

export async function updateText(text: string) {
  popup.text = text;
  await draft.setValue(text);
}

export async function updateSettings(patch: Partial<Settings>) {
  popup.settings = {
    ...popup.settings,
    ...patch
  };
  try {
    await saveSettings($state.snapshot(popup.settings));
  } catch (error) {
    popup.error = `Couldn't save settings: ${getErrorMessage(error)}`;
  }
}

async function showVoices() {
  try {
    popup.voices = await loadVoices();
  } catch (error) {
    popup.error = `Couldn't load voices: ${getErrorMessage(error)}`;
  }
}

export async function startPopup() {
  speechMessenger.onMessage(SpeechMessage.PlayerState, ({ data }) => {
    popup.player = data;
  });
  [popup.settings, popup.text] = await Promise.all([readSettings(), draft.getValue()]);
  await Promise.all([control(Command.GetState), showVoices()]);
}
