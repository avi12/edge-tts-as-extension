<script lang="ts">
  import type { Voice } from "@/lib/edge-tts/client";
  import type { Settings } from "@/lib/settings";
  import { getVoiceName, groupVoicesByLocale } from "@/lib/voices";

  const { voices, voice, isMatchingLanguage, readingVoice, onchange }: {
    voices: Voice[];
    voice: string;
    isMatchingLanguage: boolean;
    readingVoice: Voice | undefined;
    onchange: (patch: Partial<Pick<Settings, "voice" | "isMatchingLanguage">>) => void;
  } = $props();

  const voiceGroups = $derived(groupVoicesByLocale(voices));
</script>

<fieldset class="field">
  <label>
    <span>Voice</span>
    <select onchange={e => onchange({ voice: e.currentTarget.value })} value={voice}>
      {#each voiceGroups as group (group.locale)}
        <optgroup label={group.label}>
          {#each group.voices as option (option.ShortName)}
            <option value={option.ShortName}>{getVoiceName(option)} · {option.Gender}</option>
          {/each}
        </optgroup>
      {:else}
        <option value={voice}>Loading voices…</option>
      {/each}
    </select>
  </label>
  <label class="toggle">
    <input
      checked={isMatchingLanguage}
      onchange={e => onchange({ isMatchingLanguage: e.currentTarget.checked })}
      type="checkbox"
    />
    <span>Match the text's language</span>
  </label>
  {#if readingVoice}
    <p class="reading-voice">
      Reading with <strong data-speaking-voice>{getVoiceName(readingVoice)} · {readingVoice.LocaleName}</strong>
    </p>
  {/if}
</fieldset>

<style>
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  label {
    display: grid;
    gap: 4px;
  }

  .toggle {
    display: flex;
    align-items: center;
  }

  .reading-voice {
    margin: 0;
  }
</style>
