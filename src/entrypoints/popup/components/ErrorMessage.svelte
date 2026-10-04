<script lang="ts">
  const { message }: { message: string | null } = $props();
</script>

{#if message}
  <p class="callout" data-kind="danger" role="alert">{message}</p>
{/if}

<style>
  .callout {
    margin: 0;
    padding: var(--s-2) var(--s-3);
    color: var(--fg);
    font: var(--t-body-s);
    font-family: var(--font-mono);
  }
</style>
