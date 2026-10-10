<script lang="ts">
  import { interest } from "./interest";

  // The play button and the frame a card wears. Status lives on the shadow host, which overlay.css
  // styles by it, so this component holds no state of its own
  const { onplay }: { onplay: () => Promise<void> } = $props();
</script>

<span class="frame"></span>
<!-- Hovering or focusing the button shows its hint, where the browser supports interest invokers -->
<button class="play" {@attach interest("hint-play")} aria-labelledby="hint-play" onclick={onplay} type="button">
  <span class="icon icon-play">
    <!-- Ours, drawn by hand on the 24 unit grid icon sets use, so they scale with the button's font size -->
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  </span>
  <span class="icon icon-pause">
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  </span>
</button>
<!--
  A hint popover renders in the top layer, so the chamfer clip-paths around it never cut it off. The
  hint state is in the HTML standard, and a browser without it treats the popover as manual
  https://html.spec.whatwg.org/multipage/popover.html#the-popover-attribute
-->
<span id="hint-play" class="hint" popover="hint">Narrate this card</span>
