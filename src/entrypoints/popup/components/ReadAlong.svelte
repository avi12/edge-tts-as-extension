<script lang="ts">
  import type { SpokenWord } from "@/lib/player-status";

  const { text, word }: {
    text: string;
    word: SpokenWord | null;
  } = $props();

  const iWordEnd = $derived(word ? word.start + word.length : 0);
  const before = $derived(word ? text.slice(0, word.start) : text);
  const spoken = $derived(word ? text.slice(word.start, iWordEnd) : "");
  const after = $derived(word ? text.slice(iWordEnd) : "");

  function followWord(elMark: HTMLElement) {
    elMark.scrollIntoView({ block: "nearest" });
  }
</script>

<div class="control chamfer-s text-pane" aria-live="off" dir="auto">
  {before}{#if word}
    {#key word.start}<mark {@attach followWord}>{spoken}</mark>{/key}
  {/if}{after}
</div>

<style>
  mark {
    padding: 0 2px;
    background: var(--primary-container);
    color: var(--on-primary-container);
    box-shadow: var(--cyber-glow-mark);
    animation: mark-in var(--dur-medium) var(--ease-emph);
  }

  @keyframes mark-in {
    from {
      background: transparent;
      box-shadow: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    mark {
      animation: none;
    }
  }
</style>
