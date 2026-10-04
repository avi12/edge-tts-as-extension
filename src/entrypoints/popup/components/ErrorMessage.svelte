<script lang="ts">
  const { message }: { message: string | null } = $props();
</script>

{#if message}
  <p class="error" role="alert">{message}</p>
{/if}

<style>
  .error {
    margin: 0;
    color: var(--error);
    font-size: 13px;
  }
</style>
