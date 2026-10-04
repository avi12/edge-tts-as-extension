# How Edge Read Aloud works

Findings from Edge 154.0.4258.53 on Windows.

## Where the code lives

Read Aloud is a hidden component extension, **Microsoft Voices**
(`chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`), registered as a
`chrome.ttsEngine`. Its JS is packed inside `resources.pak` next to `msedge.dll`.

- `unpak.mjs` — dumps every resource from Edge's `resources.pak`
  (Edge uses 8-byte `{u32 id, u32 offset}` entries, unlike Chromium's 6-byte ones)
- `strings.mjs` — ASCII + UTF-16 `strings` for `msedge.dll`
- `edge-microsoft-voices/` — the extracted extension sources (Microsoft copyright, kept for reference only)
- `probe.mjs` — live probe of the service from Node, used to find which headers are required

## The two secrets the extension does not hold

The extension asks the browser for them:

| Value | Where it comes from |
| --- | --- |
| `TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4` | `chrome.systemPrivate.getApiKey()` — constant baked into `msedge.dll` |
| `Sec-MS-GEC`, `Sec-MS-GEC-Version` | added by native code (`microsoft_genuine_edge_token.cc`) |

`Sec-MS-GEC` = `SHA256(ticks + token)` upper-hex, where `ticks` is the current
Windows file time (100 ns units since 1601-01-01) rounded **down to 5 minutes**.
`Sec-MS-GEC-Version` = `1-<edge version>`.

## Protocol

1. `GET https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=…` → JSON voice list (no extra headers needed)
2. `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=…&Sec-MS-GEC=…&Sec-MS-GEC-Version=…&ConnectionId=<uuid hex>`
3. Send text frame `Path:speech.config` with `outputFormat: webm-24khz-16bit-mono-opus` and `wordBoundaryEnabled: "true"`
4. Send text frame `Path:ssml` with `<speak><voice><prosody>escaped text</prosody></voice></speak>`
5. Receive:
   - text `Path:turn.start`
   - binary frames: `u16 big-endian header length` + header + audio bytes
   - text `Path:audio.metadata` — JSON with `WordBoundary` offsets (100 ns ticks)
   - text `Path:turn.end` — done

## What the server checks (from `probe.mjs`)

| Origin | User-Agent | Sec-MS-GEC | Result |
| --- | --- | --- | --- |
| Edge extension | Edge | yes | OK |
| other extension | Chrome | yes | rejected |
| none | Chrome | yes | rejected |
| Edge extension | Chrome | yes | rejected |
| Edge extension | none | yes | rejected |
| Edge extension | Edge | no | rejected |

So a Chrome extension must rewrite **Origin** and **User-Agent** on the
WebSocket handshake (done with `declarativeNetRequest`) and compute `Sec-MS-GEC` itself.
