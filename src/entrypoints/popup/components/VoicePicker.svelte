<script lang="ts">
  import type { Voice } from "@/lib/edge-tts/voice-list";
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
      appearance: none;
      display: grid;
      place-content: center;
      width: 18px;
      height: 18px;
      margin: 0;
      border: 2px solid var(--border-strong);
      background: var(--surface-2);
      cursor: pointer;

      &::before {
        content: "";
        width: 8px;
        height: 8px;
        background: var(--primary);
        box-shadow: var(--cyber-glow-primary);
        transition: scale var(--dur-short) var(--ease-emph);
        scale: 0;
      }

      &:checked {
        background: var(--primary-container);

        &::before {
          scale: 1;
        }
      }

      &:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
      }
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
