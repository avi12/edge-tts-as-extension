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

<output class="status" data-status={status}>{STATUS_LABEL[status]}</output>

<style>
  .status {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;

    &[data-status="playing"] {
      color: var(--accent);
    }

    &[data-status="error"] {
      color: var(--error);
    }
  }
</style>
