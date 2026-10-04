<script lang="ts" module>
  import { RATE } from "@/lib/edge-tts/ssml";

  const RATE_FRACTION_DIGITS = 1;
</script>

<script lang="ts">
  const { rate, onchange }: {
    rate: number;
    onchange: (rate: number) => void;
  } = $props();

  let liveRate = $derived(rate);
</script>

<label class="field">
  <span class="label speed">Speed <output class="num">{liveRate.toFixed(RATE_FRACTION_DIGITS)}×</output></span>
  <input
    max={RATE.max}
    min={RATE.min}
    onchange={() => onchange(liveRate)}
    oninput={e => {
      liveRate = e.currentTarget.valueAsNumber;
    }}
    step={RATE.step}
    type="range"
    value={liveRate}
  />
</label>

<style>
  .speed {
    display: flex;
    justify-content: space-between;

    output {
      color: var(--fg);
      font-size: 13px;
    }
  }

  input {
    width: 100%;
    margin: 0;
    accent-color: var(--primary);
  }
</style>
