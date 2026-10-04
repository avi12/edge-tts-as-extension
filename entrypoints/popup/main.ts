import { fetchVoices, type Voice } from '@/lib/edge-tts';
import {
  Command,
  PlayerStatus,
  STATE_EVENT,
  type PlayerState,
  type Request,
  type StateEvent,
} from '@/lib/messages';
import { draft, RATE, settings, VOICE_CACHE_MS, voiceCache } from '@/lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textInput = $<HTMLTextAreaElement>('text');
const reading = $<HTMLDivElement>('reading');
const statusLabel = $<HTMLSpanElement>('status');
const errorLine = $<HTMLParagraphElement>('error');
const voiceSelect = $<HTMLSelectElement>('voice');
const rateInput = $<HTMLInputElement>('rate');
const rateValue = $<HTMLOutputElement>('rate-value');

const STATUS_LABEL: Record<PlayerState['status'], string> = {
  [PlayerStatus.Idle]: 'Ready',
  [PlayerStatus.Loading]: 'Loading…',
  [PlayerStatus.Playing]: 'Reading',
  [PlayerStatus.Paused]: 'Paused',
  [PlayerStatus.Error]: 'Error',
};

const formatRate = (rate: number) => `${rate.toFixed(1)}×`;

const send = (request: Request): Promise<PlayerState> =>
  browser.runtime.sendMessage(request);

function render(state: PlayerState) {
  document.body.dataset.status = state.status;
  statusLabel.textContent = STATUS_LABEL[state.status];
  errorLine.textContent = state.error ?? '';

  const { text, word } = state;
  if (!word) {
    reading.textContent = text;
    return;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(word.start, word.start + word.length);
  reading.replaceChildren(
    text.slice(0, word.start),
    mark,
    text.slice(word.start + word.length),
  );
  mark.scrollIntoView({ block: 'nearest' });
}

async function loadVoices(): Promise<Voice[]> {
  const cached = await voiceCache.getValue();
  if (cached && Date.now() - cached.fetchedAt < VOICE_CACHE_MS) return cached.voices;
  const voices = await fetchVoices();
  await voiceCache.setValue({ voices, fetchedAt: Date.now() });
  return voices;
}

function fillVoices(voices: Voice[], selected: string) {
  const byLanguage = Map.groupBy(
    [...voices].sort((a, b) => a.LocaleName.localeCompare(b.LocaleName)),
    (v) => v.LocaleName,
  );
  voiceSelect.replaceChildren(
    ...[...byLanguage].map(([language, list]) => {
      const group = document.createElement('optgroup');
      group.label = language;
      group.append(
        ...list.map((v) => {
          // "Microsoft Aria Online (Natural) - English (United States)" → "Aria"
          const name = v.FriendlyName.replace(/^Microsoft /, '').replace(/ Online.*$/, '');
          return new Option(`${name} · ${v.Gender}`, v.ShortName);
        }),
      );
      return group;
    }),
  );
  voiceSelect.value = selected;
}

async function init() {
  const saved = await settings.getValue();
  Object.assign(rateInput, {
    min: RATE.min,
    max: RATE.max,
    step: RATE.step,
    value: saved.rate,
  });
  rateValue.textContent = formatRate(saved.rate);
  textInput.value = await draft.getValue();

  render(await send({ type: Command.GetState }));

  loadVoices()
    .then((voices) => fillVoices(voices, saved.voice))
    .catch((e) => (errorLine.textContent = `Could not load voices: ${e.message}`));
}

browser.runtime.onMessage.addListener((message: StateEvent) => {
  if (message?.type === STATE_EVENT) render(message.state);
});

textInput.addEventListener('input', () => draft.setValue(textInput.value));

voiceSelect.addEventListener('change', async () => {
  settings.setValue({ ...(await settings.getValue()), voice: voiceSelect.value });
});

rateInput.addEventListener('input', async () => {
  const rate = Number(rateInput.value);
  rateValue.textContent = formatRate(rate);
  settings.setValue({ ...(await settings.getValue()), rate });
});

$('speak').addEventListener('click', async () =>
  render(await send({ type: Command.Speak, text: textInput.value })),
);
$('pause').addEventListener('click', async () => render(await send({ type: Command.Pause })));
$('resume').addEventListener('click', async () => render(await send({ type: Command.Resume })));
$('stop').addEventListener('click', async () => render(await send({ type: Command.Stop })));

init();
