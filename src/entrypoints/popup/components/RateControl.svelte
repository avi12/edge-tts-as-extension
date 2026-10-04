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
    appearance: none;
    width: 100%;
    height: 12px;
    margin: 0;
    border: 2px solid var(--border);
    background: var(--surface-2);
    cursor: pointer;

    /* Chrome has no standard pseudo-element for a range thumb */
    &::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 22px;
      border: 2px solid var(--border-strong);
      background: var(--primary-container);
      box-shadow: var(--cyber-glow-primary);
    }

    &:focus-visible {
      outline: 2px solid var(--border-strong);
      outline-offset: 3px;
    }
  }
</style>
