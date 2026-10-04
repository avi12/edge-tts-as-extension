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

<label class="field">
  <span class="label">Voice</span>
  <select class="control chamfer-s" onchange={e => onchange({ voice: e.currentTarget.value })} value={voice}>
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
  <p class="meta reading-voice">
    Reading with <strong data-speaking-voice>{getVoiceName(readingVoice)} · {readingVoice.LocaleName}</strong>
  </p>
{/if}

<style>
  select {
    min-height: 36px;
    padding: 0 var(--s-3);
  }

  .toggle {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    font: var(--t-body-m);
    cursor: pointer;

    input {
      width: 16px;
      height: 16px;
      margin: 0;
      accent-color: var(--primary);
    }
  }

  .reading-voice {
    margin: 0;
    font-size: 12px;

    strong {
      color: var(--fg);
      font-weight: 400;
    }
  }
</style>
