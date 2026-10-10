// Everything the Read Aloud service expects, recovered from Edge itself - see research/README.md

// Baked into msedge.dll, handed to Edge's extension by chrome.systemPrivate.getApiKey(). The voice list
// spells it trustedclienttoken, the synthesis gateway Ocp-Apim-Subscription-Key
export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

const VOICES_HOST = "speech.platform.bing.com";
export const VOICES_URL = `https://${VOICES_HOST}/consumer/speech/synthesize/readaloud/voices/list`;

// Edge 155 moved synthesis onto this gateway - its own extension picks the host with
// chrome.edgeSpeechPrivate.shouldUseCetoServiceUrl, and the old speech.platform.bing.com
// socket now refuses every handshake with 403
export const SYNTHESIZE_HOST = "api.msedgeservices.com";
export const SYNTHESIZE_URL = `wss://${SYNTHESIZE_HOST}/tts/cognitiveservices/websocket/v1`;

// The Edge version Sec-MS-GEC-Version claims - the server accepts older ones too, but not a missing
// or unparseable one
const EDGE_VERSION = "155.0.4283.45";
export const SEC_MS_GEC_VERSION = `1-${EDGE_VERSION}`;

// The gateway turns down any handshake whose User-Agent does not say Edge. Origin is not checked
const EDGE_MAJOR_VERSION = EDGE_VERSION.split(".")[0];
export const EDGE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
  + `(KHTML, like Gecko) Chrome/${EDGE_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${EDGE_MAJOR_VERSION}.0.0.0`;

// Two of the output formats the service documents, named as it spells them
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
export enum OutputFormat {
  WebmOpus = "webm-24khz-16bit-mono-opus",
  Mp3 = "audio-24khz-48kbitrate-mono-mp3"
}

// What the bytes of each format are, so whoever reads the stream never has to guess: audio/mpeg is
// RFC 3003, and the WebM Opus mapping is MDN's
// https://developer.mozilla.org/docs/Web/Media/Guides/Formats/WebM
export const OUTPUT_MIME_TYPES: Record<OutputFormat, string> = {
  [OutputFormat.WebmOpus]: "audio/webm; codecs=opus",
  [OutputFormat.Mp3]: "audio/mpeg"
};

// The format Edge requests - streamable through MediaSource. MP3 plays everywhere instead, which is
// what audio embedded in a page needs
export const DEFAULT_OUTPUT_FORMAT = OutputFormat.WebmOpus;
export const MP3_BITS_PER_SECOND = 48_000;

// Word boundary offsets arrive in 100 ns ticks
export const TICKS_PER_SECOND = 10_000_000;

export const DEFAULT_VOICE = "en-US-AriaNeural";
