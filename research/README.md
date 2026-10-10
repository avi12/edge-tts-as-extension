# How Edge Read Aloud works

Findings from Edge 154.0.4258.53, revisited on Edge 155.0.4283.45, on Windows.

## Where the code lives

Read Aloud is a hidden component extension, **Microsoft Voices**
(`chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`), registered as a
`chrome.ttsEngine`. Its JS is packed inside `resources.pak` next to `msedge.dll`.

- `unpak.mjs` - dumps every resource from Edge's `resources.pak`
  (Edge uses 8-byte `{u32 id, u32 offset}` entries, unlike Chromium's 6-byte ones)
- `strings.mjs` - ASCII + UTF-16 `strings` for `msedge.dll`
- `edge-microsoft-voices/` - the extracted extension sources (Microsoft copyright, kept for reference only)
- `probe.mjs` - live probe of the service from Node, used to find which headers are required

## The two secrets the extension does not hold

The extension asks the browser for them:

| Value | Where it comes from |
| --- | --- |
| `6A5AA1D4EAFF4E9FB37E23D68491D6F4` | `chrome.systemPrivate.getApiKey()` - constant baked into `msedge.dll`. The voice list calls it `trustedclienttoken`, the synthesis gateway `Ocp-Apim-Subscription-Key` |
| `Sec-MS-GEC`, `Sec-MS-GEC-Version` | added by native code (`microsoft_genuine_edge_token.cc`) |

`Sec-MS-GEC` = `SHA256(ticks + token)` upper-hex, where `ticks` is the current
Windows file time (100 ns units since 1601-01-01) rounded **down to 5 minutes**.
`Sec-MS-GEC-Version` = `1-<edge version>`.

## The move to the CETO gateway (Edge 155)

`speech.platform.bing.com/.../readaloud/edge/v1` now answers **403 Forbidden** to every
handshake, however the headers and query parameters are arranged. Edge itself has moved on:
`audioStreamer.js` and `voiceListRequester.js` pick between the old host and a second one -

```js
const CETO_SERVER_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
chrome.edgeSpeechPrivate.shouldUseCetoServiceUrl(…)   // flag: edge-speech-synthesis-use-ceto-service
```

The frame protocol is unchanged, so only the URL and the way credentials travel had to change.
The **voice list stayed on `speech.platform.bing.com`** and still answers a bare GET.

## Protocol

1. `GET https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=…` → JSON voice list (no extra headers needed)
2. `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?ConnectionId=<uuid hex>`,
   with `Ocp-Apim-Subscription-Key`, `Sec-MS-GEC`, `Sec-MS-GEC-Version` and an Edge `User-Agent`
   as **request headers** - as query parameters they are ignored
3. Send text frame `Path:speech.config` with `outputFormat: webm-24khz-16bit-mono-opus` and `wordBoundaryEnabled: "true"`
4. Send text frame `Path:ssml` with `<speak><voice><prosody>escaped text</prosody></voice></speak>`
5. Receive:
   - text `Path:turn.start`
   - binary frames: `u16 big-endian header length` + header + audio bytes
   - text `Path:audio.metadata` - JSON with `WordBoundary` offsets (100 ns ticks)
   - text `Path:turn.end` - done

## What the gateway checks (from `probe.mjs`)

| Subscription key | Sec-MS-GEC | User-Agent | Origin | Result |
| --- | --- | --- | --- | --- |
| header | header | Edge | anything, or none | OK |
| header | header | none | none | OK |
| header | header | Chrome | anything | rejected |
| header | none | Edge | - | rejected |
| none | header | Edge | - | rejected |
| query parameter | query parameter | Edge | Edge extension | rejected |

So, compared with the old endpoint:

- **Origin is no longer checked** - a Chrome extension's own origin passes
- the key and the token must be **headers**, not query parameters
- the `User-Agent` must still say `Edg/`
- `Sec-MS-GEC-Version` must parse as `1-<version>`; which version hardly matters (`1-0.0.0.0` passes), but a missing or garbage one is rejected
- the token is accepted for its own 5 minute window and one window either side, so it has to be recomputed per connection

A Chrome extension therefore rewrites **User-Agent** and adds the three service headers to its own
handshake with `declarativeNetRequest`. Only the background can reach that API (an offscreen
document cannot), so the offscreen player asks the background to refresh the rule before each socket.
