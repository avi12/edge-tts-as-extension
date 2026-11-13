<script lang="ts" module>
  import { PlayerStatus } from "@/lib/player-status";

  // Ours: the player's own statuses said in the popup's words, one label each so a new status cannot slip
  // through unlabelled
  const STATUS_LABEL: Record<PlayerStatus, string> = {
    [PlayerStatus.IDLE]: "Ready",
    [PlayerStatus.LOADING]: "Loading…",
    [PlayerStatus.PLAYING]: "Reading",
    [PlayerStatus.PAUSED]: "Paused",
    [PlayerStatus.FINISHED]: "Done",
    [PlayerStatus.ERROR]: "Error"
  };
</script>

<script lang="ts">
  const { status }: { status: PlayerStatus } = $props();
</script>

<output class="chip status" data-active={status === PlayerStatus.PLAYING} data-status={status}>
  {STATUS_LABEL[status]}
</output>

<style>
  .status {
    &::before {
      content: "";
      width: 6px;
      height: 6px;
      background: currentColor;
    }

    &[data-status="playing"] {
      color: var(--fg);

      &::before {
        background: var(--primary);
        box-shadow: var(--cyber-glow-primary);
        animation: blink 1000ms steps(2, jump-none) infinite;
      }
    }

    &[data-status="error"] {
      color: var(--danger);
    }
  }

  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status[data-status="playing"]::before {
      animation: none;
    }
  }
</style>
