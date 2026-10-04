import type { Voice } from "@/lib/edge-tts/voice-list";
import { getErrorMessage } from "@/lib/errors";
import {
  Command,
  type ControlRequest,
  type Request,
  sendRequest,
  stateEventSchema
} from "@/lib/messages";
import { IDLE_STATE, type SpeakingState } from "@/lib/player-status";
import {
  DEFAULT_SETTINGS,
  draft,
  readSettings,
  saveSettings,
  type Settings
} from "@/lib/settings";
import { loadVoices } from "@/lib/voices";
import { browser } from "wxt/browser";

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

async function send(request: Request) {
  popup.player = await sendRequest(request);
}

export function speak() {
  return send({
    type: Command.Speak,
    text: popup.text,
    voice: popup.settings.voice,
    rate: popup.settings.rate,
    isMatchingLanguage: popup.settings.isMatchingLanguage
  });
}

export function control(type: ControlRequest["type"]) {
  return send({ type });
}

export function updateText(text: string) {
  popup.text = text;
  void draft.setValue(text);
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

function receiveState(message: unknown) {
  const parsed = stateEventSchema.safeParse(message);
  if (!parsed.success) {
    return;
  }

  popup.player = parsed.data.state;
}

async function showVoices() {
  try {
    popup.voices = await loadVoices();
  } catch (error) {
    popup.error = `Couldn't load voices: ${getErrorMessage(error)}`;
  }
}

export async function startPopup() {
  browser.runtime.onMessage.addListener(receiveState);
  [popup.settings, popup.text] = await Promise.all([readSettings(), draft.getValue()]);
  await Promise.all([send({ type: Command.GetState }), showVoices()]);
}
