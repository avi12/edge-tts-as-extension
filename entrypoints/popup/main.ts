import { fetchVoices, type Voice } from "@/lib/edge-tts";
import { getErrorMessage } from "@/lib/errors";
import {
  Command,
  type ControlRequest,
  type PlayerState,
  PlayerStatus,
  type Request,
  stateEventSchema
} from "@/lib/messages";
import {
  draft,
  RATE,
  type Settings,
  settings,
  VOICE_CACHE_MS,
  voiceCache
} from "@/lib/settings";

enum ElementId {
  Text = "text",
  Reading = "reading",
  Status = "status",
  Error = "error",
  Voice = "voice",
  Rate = "rate",
  RateValue = "rate-value",
  Speak = "speak",
  Pause = "pause",
  Resume = "resume",
  Stop = "stop"
}

const STATUS_LABEL: Record<PlayerStatus, string> = {
  [PlayerStatus.Idle]: "Ready",
  [PlayerStatus.Loading]: "Loading…",
  [PlayerStatus.Playing]: "Reading",
  [PlayerStatus.Paused]: "Paused",
  [PlayerStatus.Error]: "Error"
};

const RATE_FRACTION_DIGITS = 1;
// "Microsoft Aria Online (Natural) - English (United States)" -> "Aria"
const VOICE_NAME_PREFIX = /^Microsoft /;
const VOICE_NAME_SUFFIX = / Online.*$/;

function getElement<TElement extends HTMLElement>({ id, type }: {
  id: ElementId;
  type: new () => TElement;
}) {
  const elFound = document.getElementById(id);
  if (elFound instanceof type) {
    return elFound;
  }

  throw new Error(`Missing #${id}`);
}

const elText = getElement({
  id: ElementId.Text,
  type: HTMLTextAreaElement
});
const elReading = getElement({
  id: ElementId.Reading,
  type: HTMLDivElement
});
const elStatus = getElement({
  id: ElementId.Status,
  type: HTMLSpanElement
});
const elError = getElement({
  id: ElementId.Error,
  type: HTMLParagraphElement
});
const elVoice = getElement({
  id: ElementId.Voice,
  type: HTMLSelectElement
});
const elRate = getElement({
  id: ElementId.Rate,
  type: HTMLInputElement
});
const elRateValue = getElement({
  id: ElementId.RateValue,
  type: HTMLOutputElement
});

function formatRate(rate: number) {
  return `${rate.toFixed(RATE_FRACTION_DIGITS)}×`;
}

async function send(request: Request) {
  const state: PlayerState = await browser.runtime.sendMessage(request);
  return state;
}

function render(state: PlayerState) {
  document.body.dataset.status = state.status;
  elStatus.textContent = STATUS_LABEL[state.status];
  elError.textContent = state.error ?? "";

  const { text, word } = state;
  if (!word) {
    elReading.textContent = text;
    return;
  }

  const iWordEnd = word.start + word.length;
  const elMark = document.createElement("mark");
  elMark.textContent = text.slice(word.start, iWordEnd);
  elReading.replaceChildren(text.slice(0, word.start), elMark, text.slice(iWordEnd));
  elMark.scrollIntoView({ block: "nearest" });
}

async function loadVoices() {
  const cached = await voiceCache.getValue();
  const isCacheFresh = cached !== null && Date.now() - cached.fetchedAt < VOICE_CACHE_MS;
  if (isCacheFresh) {
    return cached.voices;
  }

  const voices = await fetchVoices();
  await voiceCache.setValue({
    voices,
    fetchedAt: Date.now()
  });
  return voices;
}

function createVoiceOption(voice: Voice) {
  const name = voice.FriendlyName.replace(VOICE_NAME_PREFIX, "").replace(VOICE_NAME_SUFFIX, "");
  return new Option(`${name} · ${voice.Gender}`, voice.ShortName);
}

function fillVoices({ voices, selectedVoice }: {
  voices: Voice[];
  selectedVoice: string;
}) {
  const sortedVoices = voices.toSorted((left, right) => left.LocaleName.localeCompare(right.LocaleName));
  const elGroups: HTMLOptGroupElement[] = [];
  for (const [language, languageVoices] of Map.groupBy(sortedVoices, voice => voice.LocaleName)) {
    const elGroup = document.createElement("optgroup");
    elGroup.label = language;
    elGroup.append(...languageVoices.map(createVoiceOption));
    elGroups.push(elGroup);
  }

  elVoice.replaceChildren(...elGroups);
  elVoice.value = selectedVoice;
}

async function updateSettings(patch: Partial<Settings>) {
  await settings.setValue({
    ...await settings.getValue(),
    ...patch
  });
}

function bindControlButton({ id, type }: { id: ElementId } & ControlRequest) {
  getElement({
    id,
    type: HTMLButtonElement
  }).addEventListener("click", async () => render(await send({ type })));
}

async function init() {
  const savedSettings = await settings.getValue();
  Object.assign(elRate, {
    min: RATE.min,
    max: RATE.max,
    step: RATE.step,
    value: savedSettings.rate
  });
  elRateValue.textContent = formatRate(savedSettings.rate);
  elText.value = await draft.getValue();

  render(await send({ type: Command.GetState }));

  try {
    fillVoices({
      voices: await loadVoices(),
      selectedVoice: savedSettings.voice
    });
  } catch (error) {
    elError.textContent = `Couldn't load voices: ${getErrorMessage(error)}`;
  }
}

browser.runtime.onMessage.addListener(message => {
  const parsed = stateEventSchema.safeParse(message);
  if (!parsed.success) {
    return;
  }

  render(parsed.data.state);
});

elText.addEventListener("input", () => draft.setValue(elText.value));
elVoice.addEventListener("change", () => updateSettings({ voice: elVoice.value }));
elRate.addEventListener("input", async () => {
  const rate = Number(elRate.value);
  elRateValue.textContent = formatRate(rate);
  await updateSettings({ rate });
});

getElement({
  id: ElementId.Speak,
  type: HTMLButtonElement
}).addEventListener("click", async () => render(
  await send({
    type: Command.Speak,
    text: elText.value
  })
));
bindControlButton({
  id: ElementId.Pause,
  type: Command.Pause
});
bindControlButton({
  id: ElementId.Resume,
  type: Command.Resume
});
bindControlButton({
  id: ElementId.Stop,
  type: Command.Stop
});

void init();
