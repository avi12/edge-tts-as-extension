<script lang="ts">
  import { interest } from "./interest";
  import { PanelAction } from "./panel-action";
  import type { Voice } from "@/lib/edge-tts/voice-list";
  import { PlayerStatus, type SpeakingState } from "@/lib/player-status";
  import { getVoiceLabel } from "@/lib/voice-names";

  const SUBTITLE_WORD = /\S+/g;
  // A voice id is the service's ShortName, spelled language-region-NameNeural, with Multilingual
  // before Neural on the multilingual voices
  // https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices
  const VOICE_NAME_SEPARATOR = "-";
  const VOICE_NAME_SUFFIX = /(?:Multilingual)?Neural$/;
  const HALVED = 2;

  // The text between the previous word and this one is kept as it was written, so a line break in a
  // script still reads as one
  interface SubtitlePart {
    gap: string;
    word: string;
    start: number;
  }

  const { cardCount, onaction, onvoice }: {
    cardCount: number;
    onaction: (action: PanelAction) => Promise<void>;
    onvoice: (voice: string) => Promise<void>;
  } = $props();

  let reading = $state<SpeakingState | null>(null);
  let title = $state<string | null>(null);
  let iCard = $state<number | null>(null);
  let locale = $state<string | null>(null);
  let voices = $state<Voice[]>([]);
  let voice = $state("");
  let elSubtitle = $state<HTMLElement>();
  let voiceQuery = $state("");
  let elVoiceList = $state<HTMLElement>();
  let elVoiceSearch = $state<HTMLInputElement>();

  // Everything the panel shows arrives in one call, the way its imperative version worked
  export function render(next: {
    state: SpeakingState | null;
    title: string | null;
    iCard: number | null;
    locale: string | null;
    voices: Voice[];
    voice: string;
  }) {
    reading = next.state;
    title = next.title;
    iCard = next.iCard;
    locale = next.locale;
    voices = next.voices;
    voice = next.voice;
  }

  function getShortVoiceName(shortName: string) {
    return shortName.split(VOICE_NAME_SEPARATOR).at(-1)?.replace(VOICE_NAME_SUFFIX, "") ?? shortName;
  }

  const voiceLabels = $derived(
    voices.map(candidate => ({
      label: getVoiceLabel(candidate),
      shortName: candidate.ShortName
    }))
  );
  const pickedVoiceLabel = $derived(voiceLabels.find(candidate => candidate.shortName === voice)?.label ?? voice);

  const shownVoiceLabels = $derived(
    voiceLabels.filter(candidate => candidate.label.toLowerCase().includes(voiceQuery.trim().toLowerCase()))
  );

  async function pickVoice(shortName: string) {
    elVoiceList?.hidePopover();
    await onvoice(shortName);
  }

  function onVoiceListToggle(e: ToggleEvent) {
    voiceQuery = "";

    if (e.newState !== "open") {
      return;
    }

    elVoiceSearch?.focus();
    elVoiceList?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "center" });
  }

  const status = $derived(reading?.status ?? PlayerStatus.Idle);
  const heading = $derived(title === null || iCard === null ? "" : `${iCard + 1}/${cardCount} ${title}`);
  const voiceName = $derived(reading?.voice ? getShortVoiceName(reading.voice) : "");
  const tourLabel = $derived(`Play tour · ${cardCount} ${cardCount === 1 ? "card" : "cards"}`);
  // An error has no words to follow, so the subtitle empties rather than freezing mid-sentence
  const subtitleText = $derived(!reading || reading.status === PlayerStatus.Error ? "" : reading.text);
  const spokenStart = $derived(reading?.word?.start ?? -1);
  // Every word is its own span, so a click on one can jump the narration there
  const parts = $derived.by(() => {
    const subtitleParts: SubtitlePart[] = [];
    let iTextEnd = 0;
    for (const match of subtitleText.matchAll(SUBTITLE_WORD)) {
      subtitleParts.push({
        gap: subtitleText.slice(iTextEnd, match.index),
        word: match[0],
        start: match.index
      });
      iTextEnd = match.index + match[0].length;
    }

    return subtitleParts;
  });
  const trailingText = $derived.by(() => {
    const lastPart = parts.at(-1);
    return lastPart ? subtitleText.slice(lastPart.start + lastPart.word.length) : subtitleText;
  });

  // The spoken word stays in the middle of the pane instead of scrolling off the bottom of it.
  // The word the effect follows is found in the DOM, so the position it follows has to be read here
  // for the effect to run again on the next word
  $effect(() => {
    const isFollowingAWord = spokenStart >= 0 && subtitleText !== "";
    const elSpoken = elSubtitle?.querySelector<HTMLElement>("[data-spoken]");
    if (!isFollowingAWord || !elSubtitle || !elSpoken) {
      return;
    }

    const centeredScrollTop = elSpoken.offsetTop - (elSubtitle.clientHeight - elSpoken.offsetHeight) / HALVED;
    elSubtitle.scrollTop = Math.max(centeredScrollTop, 0);
  });
</script>

<section class="panel" data-status={status}>
  <header>
    <span class="label">Narration</span>
    <output class="title" dir="auto">{heading}</output>
    {#if voices.length > 0}
      <button
        class="voice voice-picker"
        {@attach interest("voice-tip")}
        aria-label="Voice"
        popovertarget="voice-list"
        type="button"
      >{pickedVoiceLabel}<span id="voice-tip" class="tip" aria-hidden="true" popover="hint">{pickedVoiceLabel}</span></button>
      <div bind:this={elVoiceList} id="voice-list" class="voice-list" ontoggle={onVoiceListToggle} popover="auto">
        <input
          bind:this={elVoiceSearch}
          aria-label="Search voices"
          autocomplete="off"
          placeholder="Search voices"
          type="search"
          bind:value={voiceQuery}
        />
        <ul aria-label="Voices" role="listbox">
          {#each shownVoiceLabels as option (option.shortName)}
            <li class="option" aria-selected={option.shortName === voice} role="option">
              <button
                {@attach interest(`voice-tip-${option.shortName}`)}
                onclick={() => pickVoice(option.shortName)}
                type="button"
              >{option.label}<span
                id="voice-tip-{option.shortName}"
                class="tip"
                aria-hidden="true"
                popover="hint">{option.label}</span></button>
            </li>
          {/each}
        </ul>
      </div>
    {:else}
      <output class="voice" aria-label="Voice">{voiceName}</output>
    {/if}
  </header>
  <!-- A click on a word seeks, and the runtime that mounts this panel listens for it on the shadow root -->
  <p bind:this={elSubtitle} class="subtitle" dir="auto" lang={locale ?? ""}
  >{#each parts as part (part.start)}{part.gap}<span
    data-spoken={part.start <= spokenStart && spokenStart < part.start + part.word.length ? "" : undefined}
    data-start={part.start}>{part.word}</span>{/each}{trailingText}</p>
  <p class="error">{reading?.error ?? ""}</p>
  <menu class="controls">
    <li data-action={PanelAction.Tour}>
      <button onclick={() => onaction(PanelAction.Tour)} type="button">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
        <span class="tour-label">{tourLabel}</span>
      </button>
    </li>
    <li data-action={PanelAction.Previous}>
      <button {@attach interest("hint-previous")} onclick={() => onaction(PanelAction.Previous)} type="button">Prev</button>
      <span id="hint-previous" class="hint" popover="hint">Previous card</span>
    </li>
    <li data-action={PanelAction.Back}>
      <button {@attach interest("hint-back")} onclick={() => onaction(PanelAction.Back)} type="button">Back</button>
      <span id="hint-back" class="hint" popover="hint">Back to the start of the sentence</span>
    </li>
    <li data-action={PanelAction.Pause}>
      <button
        {@attach interest("hint-pause")}
        aria-labelledby="hint-pause"
        onclick={() => onaction(PanelAction.Pause)}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
      </button>
      <span id="hint-pause" class="hint" popover="hint">Pause</span>
    </li>
    <li data-action={PanelAction.Resume}>
      <button
        {@attach interest("hint-resume")}
        aria-labelledby="hint-resume"
        onclick={() => onaction(PanelAction.Resume)}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
      </button>
      <span id="hint-resume" class="hint" popover="hint">Resume</span>
    </li>
    <li data-action={PanelAction.Next}>
      <button {@attach interest("hint-next")} onclick={() => onaction(PanelAction.Next)} type="button">Next</button>
      <span id="hint-next" class="hint" popover="hint">Next card</span>
    </li>
    <li data-action={PanelAction.Stop}>
      <button {@attach interest("hint-stop")} onclick={() => onaction(PanelAction.Stop)} type="button">Stop</button>
      <span id="hint-stop" class="hint" popover="hint">Stop</span>
    </li>
  </menu>
</section>
