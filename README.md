# Edge Read Aloud, reverse engineered

Microsoft Edge's Read Aloud voices, usable outside Edge: a `narrate` CLI that bakes voice narration into
Claude artifact pages, and a Chrome extension (built with [WXT](https://wxt.dev)) that reads text aloud.
How the Edge feature works, and how it was recovered, is in [research/README.md](research/README.md).

## Narrated artifacts

Narration is designed into a page at authoring time and pre-rendered, so it plays in any browser with no
extension. Give each card a spoken script, with `[[cue]]` markers right before the words that introduce a part:

```html
<section data-narrate="The popup sends a request [[wire]] across the wire to the speech service">
  <svg>... <path data-cue="wire" /> ...</svg>
</section>
<style>
  [data-narrating]:not([data-cued~="wire"]) [data-cue="wire"] { opacity: 0.2 }
  [data-cued~="wire"] [data-cue="wire"] { animation: draw 0.6s both }
</style>
```

```sh
pnpm narrate page.html                   # embeds mp3 audio, word and cue timings and the runtime, in place
pnpm narrate page.html --out narrated.html --voice en-GB-SoniaNeural --rate 1.1
pnpm narrate page.html --export clips    # also writes NN-slug.mp3 + timings JSON per card, for Manim
```

The embedded runtime (`src/narration-runtime/`, about 11 KB) adds a play button to each narrated card and a
tour panel with live subtitles. While a card plays it sets `data-narrating` on it and adds each cue to
`data-cued` the moment its word is spoken, so the page's own CSS animates in step with the voice. It also
fires a bubbling `narration:cue` event. Re-running the CLI replaces its own block.

## The extension

```sh
pnpm install
pnpm build          # → .output/chrome-mv3, load it via chrome://extensions → Load unpacked
pnpm dev            # opens a Chrome with the extension and hot reload
```

- **Popup** - paste text, pick a voice and speed, press *Read aloud*
- **Other extensions** - `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'speak', text, voice?, rate? })`;
  also `pause`, `resume`, `stop`, `get-state`

## Layout

| Path | Role |
| --- | --- |
| `src/lib/edge-tts/` | The reimplemented protocol: token, `Sec-MS-GEC`, SSML, frames, streaming client, voices, chunking |
| `src/lib/narration.ts` | Narration contract, `[[cue]]` parser and timing |
| `src/cli/narrate.ts` | The `narrate` CLI: pre-renders and embeds page narration |
| `src/narration-runtime/` | The runtime embedded in narrated pages: buttons, tour panel, cue sync |
| `src/lib/messages.ts` | Message contract shared by every part of the extension |
| `src/entrypoints/background.ts` | Header-rewrite rule, message routing |
| `src/entrypoints/offscreen/` | Player: streams audio into a `MediaSource`, tracks the spoken word |
| `src/entrypoints/popup/` | UI with read-along highlighting |

## Tests

```sh
pnpm test           # unit tests
LIVE=1 pnpm test    # also hits the real service
pnpm check          # compile, lint, stylelint, fallow dead-code, tests
```

## Caveat

This uses an undocumented Microsoft endpoint by impersonating Edge. It can
break whenever Microsoft changes the checks, and it may conflict with their
terms of use. If it stops working, re-run `research/probe.mjs` and compare
against the current Edge build with `research/unpak.mjs`.
