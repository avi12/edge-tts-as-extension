<script lang="ts">
  import { Command, type ControlRequest } from "@/lib/messages";
  import { isReadingStatus, PlayerStatus } from "@/lib/player-status";

  const { status, onspeak, oncontrol }: {
    status: PlayerStatus;
    onspeak: () => void;
    oncontrol: (type: ControlRequest["type"]) => void;
  } = $props();

  const isReading = $derived(isReadingStatus(status));
</script>

<menu class="actions">
  {#if status === PlayerStatus.Paused}
    <li><button class="primary" onclick={() => oncontrol(Command.Resume)}>Resume</button></li>
  {:else if isReading}
    <li>
      <button disabled={status === PlayerStatus.Loading} onclick={() => oncontrol(Command.Pause)}>Pause</button>
    </li>
  {:else}
    <li><button class="primary" onclick={onspeak}>Read aloud</button></li>
  {/if}
  {#if isReading}
    <li><button onclick={() => oncontrol(Command.Stop)}>Stop</button></li>
  {/if}
</menu>

<style>
  .actions {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: contents;
    }
  }
</style>
