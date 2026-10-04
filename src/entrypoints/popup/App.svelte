<script lang="ts">
  import ErrorMessage from "./components/ErrorMessage.svelte";
  import RateControl from "./components/RateControl.svelte";
  import ReadAlong from "./components/ReadAlong.svelte";
  import StatusBadge from "./components/StatusBadge.svelte";
  import TextEditor from "./components/TextEditor.svelte";
  import TransportControls from "./components/TransportControls.svelte";
  import VoicePicker from "./components/VoicePicker.svelte";
  import {
    control,
    popup,
    speak,
    startPopup,
    updateSettings,
    updateText
  } from "./popup-state.svelte";
  import { isReadingStatus } from "@/lib/player-status";
  import { onMount } from "svelte";

  const isReading = $derived(isReadingStatus(popup.player.status));
  const readingVoice = $derived(popup.voices.find(voice => voice.ShortName === popup.player.voice));

  onMount(startPopup);
</script>

<header>
  <h1>Read Aloud</h1>
  <StatusBadge status={popup.player.status} />
</header>

{#if isReading}
  <ReadAlong text={popup.player.text} word={popup.player.word} />
{:else}
  <TextEditor oninput={updateText} text={popup.text} />
{/if}

<ErrorMessage message={popup.player.error ?? popup.error} />

<VoicePicker
  isMatchingLanguage={popup.settings.isMatchingLanguage}
  onchange={updateSettings}
  {readingVoice}
  voice={popup.settings.voice}
  voices={popup.voices}
/>
<RateControl onchange={rate => updateSettings({ rate })} rate={popup.settings.rate} />
<TransportControls oncontrol={control} onspeak={speak} status={popup.player.status} />
