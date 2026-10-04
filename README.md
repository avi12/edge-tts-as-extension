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

## Layout

| Path | Role |
| --- | --- |
| `lib/edge-tts/` | The reimplemented protocol: token, `Sec-MS-GEC`, SSML, frames, streaming client, voices, chunking |
| `lib/messages.ts` | Message contract shared by every part of the extension |
| `entrypoints/background.ts` | Header-rewrite rule, context menu, shortcut, message routing |
| `entrypoints/offscreen/` | Player: streams audio into a `MediaSource`, tracks the spoken word |
| `entrypoints/popup/` | UI with read-along highlighting |

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
