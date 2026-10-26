<script lang="ts">
  import type { Voice } from "@/lib/edge-tts/voice-list";
  import { getVoiceName, groupVoicesByLocale } from "@/lib/voice-names";

  // The options of a voice select, one group per language - shared by the popup and the narration panel
  const { voices }: { voices: Voice[] } = $props();

  const voiceGroups = $derived(groupVoicesByLocale(voices));
</script>

{#each voiceGroups as group (group.locale)}
  <optgroup label={group.label}>
    {#each group.voices as option (option.ShortName)}
      <option value={option.ShortName}>{getVoiceName(option)} · {option.Gender}</option>
    {/each}
  </optgroup>
{/each}
