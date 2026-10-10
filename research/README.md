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
   with `Ocp-Apim-Subscription-Key`, `Sec-MS-GEC` and `Sec-MS-GEC-Version` as **request headers or
   query parameters - either is accepted** (this client sends them as query parameters: the token is
   recomputed per connection, and a `declarativeNetRequest` rule carrying it would have to be
   rewritten before every socket, while the `User-Agent` it does rewrite never changes), and an
   Edge `User-Agent`, which is the one thing that has to be a header
3. Send text frame `Path:speech.config` with `outputFormat: webm-24khz-16bit-mono-opus` and `wordBoundaryEnabled: "true"`
4. Send text frame `Path:ssml` with `<speak><voice><prosody>escaped text</prosody></voice></speak>`
5. Receive:
   - text `Path:turn.start`
   - binary frames: `u16 big-endian header length` + header + audio bytes
   - text `Path:audio.metadata` - JSON with `WordBoundary` offsets (100 ns ticks)
   - text `Path:turn.end` - done

## What the prosody values are worth

Microsoft documents the range: ["The rate changes should be within `0.5` to `2` times the original
audio"](https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup-voice#adjust-prosody),
with `x-slow` = 0.5 and `x-fast` = 2. The service enforces it by clamping, so asking for anything
outside gets the same audio back, byte for byte (same text, same voice, the default
`webm-24khz-16bit-mono-opus`):

| `rate` asked for | audio returned |
| --- | --- |
| 0.1, 0.25, 0.5 | 32,692 bytes - all identical |
| 1 | 16,590 bytes |
| 2, 2.5, 3, 4, 10 | 12,014 bytes - all identical |

So `RATE_RANGE` in `lib/edge-tts/ssml.ts` is the documented range, confirmed against the live
service - not a slider's taste. How finely the popup's slider cuts that range is the popup's own
business and lives with the control.

The [output formats](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs)
and the [voice list fields](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#get-a-list-of-voices)
are documented the same way, so `OutputFormat` and `Voice` spell them as the service does. The list
is 322 voices, every one `Gender: "Female"` or `"Male"` - a two-value vocabulary today, but it is
the service's to extend, so the client keeps that field a string.

## What the gateway checks (from `probe.mjs`)

| Subscription key | Sec-MS-GEC | User-Agent | Origin | Result |
| --- | --- | --- | --- | --- |
| header | header | Edge | anything, or none | OK |
| header | header | none | none | OK |
| header | header | Chrome | anything | rejected |
| header | none | Edge | - | rejected |
| none | header | Edge | - | rejected |
| query parameter | query parameter | Edge | Edge extension | OK |
| query parameter | query parameter | Chrome | - | rejected |
| none | none | Edge | - | rejected |

The last three rows were re-measured on 2026-10-10, and the first of them corrects what this file
said before: the gateway reads the credentials from the query string just as happily as from the
headers, and sending them both ways at once is fine too. What it will not do is let a handshake
through without them, or with a `User-Agent` that does not say `Edg/`.

So, compared with the old endpoint:

- **Origin is no longer checked** - a Chrome extension's own origin passes
- the key and the token may be **headers or query parameters**
- the `User-Agent` must still say `Edg/`, and it is the only one that has to be a header
- `Sec-MS-GEC-Version` must parse as `1-<version>`; which version hardly matters (`1-0.0.0.0` passes), but a missing or garbage one is rejected
- the token is accepted for its own 5 minute window and one window either side, so it has to be recomputed per connection

A Chrome extension therefore only has to rewrite **User-Agent** with `declarativeNetRequest`, and
carries the three credentials in the socket's query string. Only the background can reach that API
(an offscreen document cannot), so the rule is installed there, once, for this extension's own
requests to the gateway host.
