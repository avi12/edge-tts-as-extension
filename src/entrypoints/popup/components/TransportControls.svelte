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
    <li><button class="btn" data-variant="primary" onclick={() => oncontrol(Command.Resume)}>Resume</button></li>
  {:else if isReading}
    <li>
      <button class="btn" disabled={status === PlayerStatus.Loading} onclick={() => oncontrol(Command.Pause)}>
        Pause
      </button>
    </li>
  {:else}
    <li><button class="btn" data-variant="primary" onclick={onspeak}>Read aloud</button></li>
  {/if}
  {#if isReading}
    <li><button class="btn" data-variant="danger" onclick={() => oncontrol(Command.Stop)}>Stop</button></li>
  {/if}
</menu>

<style>
  .actions {
    display: flex;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: contents;
    }
  }

  .btn {
    flex: 1;
    justify-content: center;
    min-height: 40px;
    transition:
      background-color var(--dur-short) var(--ease-emph),
      translate var(--dur-short) var(--ease-emph),
      border-color var(--dur-theme) var(--ease-emph),
      color var(--dur-theme) var(--ease-emph),
      box-shadow var(--dur-theme) var(--ease-emph);

    &:disabled {
      opacity: 45%;
      cursor: default;
    }

    &:focus-visible {
      outline: none;
      box-shadow: var(--cyber-active-ring), inset 0 0 0 2px var(--fg);
    }

    &:active:not(:disabled) {
      translate: 1px 1px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;

      &:active:not(:disabled) {
        translate: none;
      }
    }
  }
</style>
