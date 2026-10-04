# Edge Read Aloud for Chrome

A Chrome extension (built with [WXT](https://wxt.dev)) that reads text aloud
with the same online neural voices as Microsoft Edge's Read Aloud. How the
Edge feature works, and how it was recovered, is in [research/README.md](research/README.md).

## Use it

```sh
pnpm install
pnpm build          # → .output/chrome-mv3, load it via chrome://extensions → Load unpacked
pnpm dev            # opens a Chrome with the extension and hot reload
```

Ways to send it text:

- **Popup** - paste text, pick a voice and speed, press *Read aloud*
- **Right-click** selected text → *Read aloud*
- **Alt+Shift+R** reads the current selection
- **Other extensions** - `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'speak', text, voice?, rate? })`;
  also `pause`, `resume`, `stop`, `get-state`

## Claude artifacts

Inside Claude artifact pages (published `claude.ai/artifact/...` pages and artifacts in a chat) every card
with a `data-narrate` script gets a play button, and a panel offers a tour of all cards with live subtitles.
Pages without scripts fall back to reading each captioned card. Page authors can sync animation to the voice:

```html
<section data-narrate="The popup sends a request [[wire]] across the wire to the speech service">
  <svg>... <path data-cue="wire" /> ...</svg>
</section>
<style>
  [data-narrating]:not([data-cued~="wire"]) [data-cue="wire"] { opacity: 0.2 }
</style>
```

The narrator sets `data-narrating` on the card while it speaks and adds each cue to `data-cued` the
moment its word is spoken. It also posts `{ source: "edge-read-aloud", type: "narration", card, cue, status }`
to the page. Without the extension the page is unchanged.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/edge-tts/` | The reimplemented protocol: token, `Sec-MS-GEC`, SSML, frames, streaming client, voices, chunking |
| `src/lib/messages.ts` | Message contract shared by every part of the extension |
| `src/entrypoints/background.ts` | Header-rewrite rule, context menu, shortcut, message routing |
| `src/entrypoints/offscreen/` | Player: streams audio into a `MediaSource`, tracks the spoken word |
| `src/entrypoints/popup/` | UI with read-along highlighting |
| `src/entrypoints/artifact-narrator.content/` | Narration buttons, tour panel and cue sync inside Claude artifact frames |
| `src/lib/narration.ts` | Narration contract and the `[[cue]]` script parser |

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
