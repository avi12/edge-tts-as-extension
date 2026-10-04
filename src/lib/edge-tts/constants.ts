// Everything the Read Aloud service expects, recovered from Edge itself - see research/README.md

// Baked into msedge.dll, handed to Edge's extension by chrome.systemPrivate.getApiKey()
export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

export const SERVICE_HOST = "speech.platform.bing.com";
const SERVICE_BASE = `${SERVICE_HOST}/consumer/speech/synthesize/readaloud`;
export const SYNTHESIZE_URL = `wss://${SERVICE_BASE}/edge/v1`;
export const VOICES_URL = `https://${SERVICE_BASE}/voices/list`;

// The Edge version Sec-MS-GEC-Version claims - the server accepts older ones too
const EDGE_VERSION = "154.0.4258.53";
export const SEC_MS_GEC_VERSION = `1-${EDGE_VERSION}`;

// The server only accepts handshakes that look like they come from Edge's Microsoft Voices extension
export const EDGE_EXTENSION_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_MAJOR_VERSION = EDGE_VERSION.split(".")[0];
export const EDGE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
  + `(KHTML, like Gecko) Chrome/${EDGE_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_MAJOR_VERSION}.0.0.0`;

// The format Edge requests - streamable through MediaSource
export const OUTPUT_FORMAT = "webm-24khz-16bit-mono-opus";
export const AUDIO_MIME_TYPE = "audio/webm; codecs=opus";

// MP3 plays everywhere, for audio embedded in pages
export const MP3_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
export const MP3_MIME_TYPE = "audio/mpeg";
export const MP3_BITS_PER_SECOND = 48_000;

// Word boundary offsets arrive in 100 ns ticks
export const TICKS_PER_SECOND = 10_000_000;

export const DEFAULT_VOICE = "en-US-AriaNeural";
