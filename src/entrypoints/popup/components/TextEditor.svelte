<script lang="ts">
  const { text, oninput }: {
    text: string;
    oninput: (text: string) => void;
  } = $props();
</script>

<textarea
  class="control chamfer-s text-pane"
  aria-label="Text to read"
  dir="auto"
  oninput={e => oninput(e.currentTarget.value)}
  placeholder="Paste or type text to read…"
  spellcheck="false"
  value={text}
></textarea>

<style>
  textarea {
    resize: none;

    &::placeholder {
      color: var(--fg-subtle);
      font-family: var(--font-mono);
    }
  }
</style>
