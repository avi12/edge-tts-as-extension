<script lang="ts">
  const { text, oninput }: {
    text: string;
    oninput: (text: string) => void;
  } = $props();
</script>

<textarea
  aria-label="Text to read"
  oninput={e => oninput(e.currentTarget.value)}
  placeholder="Paste or type text to read…"
  spellcheck="false"
  value={text}
></textarea>

<style>
  textarea {
    resize: vertical;
  }
</style>
