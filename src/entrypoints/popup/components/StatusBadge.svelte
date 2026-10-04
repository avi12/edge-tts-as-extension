<script lang="ts" module>
  import { PlayerStatus } from "@/lib/player-status";

  const STATUS_LABEL: Record<PlayerStatus, string> = {
    [PlayerStatus.Idle]: "Ready",
    [PlayerStatus.Loading]: "Loading…",
    [PlayerStatus.Playing]: "Reading",
    [PlayerStatus.Paused]: "Paused",
    [PlayerStatus.Finished]: "Done",
    [PlayerStatus.Error]: "Error"
  };
</script>

<script lang="ts">
  const { status }: { status: PlayerStatus } = $props();
</script>

<output class="chip status" data-active={status === PlayerStatus.Playing} data-status={status}>
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
      opacity: 25%;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status[data-status="playing"]::before {
      animation: none;
    }
  }
</style>
