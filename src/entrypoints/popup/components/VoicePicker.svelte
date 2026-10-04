<script lang="ts">
  import type { Voice } from "@/lib/edge-tts/client";
  import { getVoiceName, groupVoicesByLocale } from "@/lib/voices";

  const { voices, voice, onchange }: {
    voices: Voice[];
    voice: string;
    onchange: (voice: string) => void;
  } = $props();

  const voiceGroups = $derived(groupVoicesByLocale(voices));
</script>

<label class="field">
  <span>Voice</span>
  <select onchange={e => onchange(e.currentTarget.value)} value={voice}>
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
