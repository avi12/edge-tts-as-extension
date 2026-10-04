// Everything the Read Aloud service expects, recovered from Edge itself.
// See research/README.md for where each value was found.

/** Baked into msedge.dll; handed to Edge's extension by chrome.systemPrivate.getApiKey(). */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
export const SERVICE_HOST = 'speech.platform.bing.com';
export const SYNTHESIZE_URL = `wss://${BASE}/edge/v1`;
export const VOICES_URL = `https://${BASE}/voices/list`;

/** Edge version the Sec-MS-GEC-Version header claims; the server accepts older ones too. */
export const EDGE_VERSION = '154.0.4258.53';
export const SEC_MS_GEC_VERSION = `1-${EDGE_VERSION}`;

/** The server only accepts handshakes that look like they come from Edge's Microsoft Voices extension. */
export const EDGE_EXTENSION_ORIGIN =
  'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_MAJOR = EDGE_VERSION.split('.')[0];
export const EDGE_USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${EDGE_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_MAJOR}.0.0.0`;

/** Same format Edge requests: streamable through MediaSource. */
export const OUTPUT_FORMAT = 'webm-24khz-16bit-mono-opus';
export const AUDIO_MIME = 'audio/webm; codecs=opus';

/** Word boundary offsets arrive in 100 ns ticks. */
export const TICKS_PER_SECOND = 10_000_000;

export const DEFAULT_VOICE = 'en-US-AriaNeural';
