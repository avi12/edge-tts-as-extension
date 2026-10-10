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
  [data-narrating] [data-cue]:not([data-cue-reached]) { opacity: 0.2 }
  [data-cue-reached] { animation: enter 0.6s both }
</style>
```

```sh
pnpm narrate page.src.html --out page.html   # embeds mp3 audio, word and cue timings and the runtime
pnpm narrate page.html --voice en-GB-SoniaNeural --rate 1.1   # in place; re-running replaces its own block
pnpm narrate page.html --export clips    # also writes NN-slug.mp3 + timings JSON per card, for Manim
```

The embedded runtime (`src/narration-runtime/`, about 11 KB) adds a play button to each narrated card and a
tour panel with live subtitles. While a card plays it sets `data-narrating` on it, and the moment a cue's
word is spoken it adds the cue to the card's `data-cued` list and sets `data-cue-reached` on every matching
`data-cue` element, so the page's own CSS animates in step with the voice - two generic rules cover every
cue. Both follow seeks and clear when the clip ends. It also fires a bubbling `narration:cue` event.

Each card is voiced in its own language: a non-Latin script decides it (Hebrew text gets a Hebrew voice),
otherwise the nearest `lang` attribute does (`lang="fr"` gets a French voice), and a card with neither keeps
`--voice`. A switched voice matches `--voice`'s gender where it can, and `data-narrate-voice="en-GB-RyanNeural"`
pins one card's voice outright. Subtitles take the voice's language and direction, so Hebrew reads right to left.

With the extension installed, narrated pages speak live in the voice picked in its popup instead of the
recorded one: a small bridge content script (in Claude's artifact frames and on `localhost`) hands each card to
the extension's player, a card in another language still gets a voice that speaks it, and cues and subtitles
follow the live words. Without the extension, or if live speech fails, the recorded audio plays.

A page never run through the CLI - say, an artifact a Claude chat just wrote with `data-narrate` scripts and
`data-cue` parts - still speaks when the extension is installed: its `narration-live` content script finds the
scripts and starts the runtime itself, live only. Such a page has no recording, so without the extension it
stays a silent (complete) page.

Cue names are letters, digits, `_` and `-`, scoped to their card. The CLI fails on an empty script and warns
when a marker has no `data-cue` element or the reverse. Relative paths resolve from where you ran it, so
`pnpm --dir <repo> narrate page.html` works from anywhere. Keep the authored page as `page.src.html` and
narrate into `page.html`: the embedded audio (about 8 KB per spoken second) makes the output hard to diff.

## The extension

```sh
pnpm install
pnpm build          # → .output/chrome-mv3, load it via chrome://extensions → Load unpacked
pnpm dev            # opens a Chrome with the extension and hot reload
```

- **Popup** - paste text, pick a voice and speed, press *Read aloud*. *Match the text's language* swaps in a voice
  that speaks the text's script (Hebrew text gets a Hebrew voice), keeping your voice for text it already speaks
- **Other extensions** - `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'speak', text, voice?, rate?, isMatchingLanguage? })`;
  also `pause`, `resume`, `stop`, `get-state`

## Layout

| Path | Role |
| --- | --- |
| `src/lib/edge-tts/` | The reimplemented protocol: token, `Sec-MS-GEC`, SSML, frames, streaming client, voices, chunking |
| `src/lib/narration.ts` | Narration contract, `[[cue]]` parser and timing |
| `src/cli/narrate.ts` | The `narrate` CLI: pre-renders and embeds page narration |
| `src/narration-runtime/` | The runtime embedded in narrated pages: buttons, tour panel, cue sync |
| `src/entrypoints/narration-live.content.ts` | Runs that runtime, live only, on pages the CLI never narrated |
| `src/lib/messages.ts` | The extension's message bus: one `@webext-core/messaging` protocol map, keyed by an enum |
| `src/lib/narration-bridge.ts` | The page's message bus: custom events between a narrated page and the bridge |
| `src/entrypoints/background.ts` | Header-rewrite rule, message routing |
| `src/entrypoints/offscreen/` | Player: streams audio into a `MediaSource`, tracks the spoken word |
| `src/entrypoints/popup/` | Svelte 5 UI with read-along highlighting |

## Tests

```sh
pnpm test           # unit tests
LIVE=1 pnpm test    # also hits the real service
pnpm check          # compile, svelte-check, lint, stylelint, fallow dead-code, tests
```

## Caveat

This uses an undocumented Microsoft endpoint by impersonating Edge. It can
break whenever Microsoft changes the checks, and it may conflict with their
terms of use. If it stops working, re-run `research/probe.mjs` and compare
against the current Edge build with `research/unpak.mjs`.
