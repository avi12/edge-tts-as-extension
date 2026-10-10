import { type OutputFormat, SEC_MS_GEC_VERSION, SYNTHESIZE_URL, TRUSTED_CLIENT_TOKEN } from "./constants";
import { secMsGec } from "./gec";
import {
  configMessage,
  createId,
  FramePath,
  parseBinaryFrame,
  parseTextFrame,
  parseWordBoundaries,
  ssmlMessage,
  type WordBoundary
} from "./protocol";
import { buildSsml, type Prosody } from "./ssml";

// What each credential is called: Edge's audioStreamer.js hangs Ocp-Apim-Subscription-Key and
// ConnectionId on the gateway url, and its native code names Sec-MS-GEC and Sec-MS-GEC-Version
// (research/README.md)
// Only the first has a published source, and there it is an HTTP request header carrying an Azure
// resource key - this client sends the same name as a query parameter carrying the token out of
// msedge.dll (TRUSTED_CLIENT_TOKEN)
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#authentication
// The other three are documented nowhere: the two Sec-MS-GEC ones were read out of Edge's native code
// (microsoft_genuine_edge_token.cc, recomputed in gec.ts), ConnectionId out of audioStreamer.js, which
// mints one id per socket
// The gateway takes all three credentials as query parameters or as request headers, measured either
// way (research/README.md). The query string is what this client uses, because the token is recomputed
// per socket and a declarativeNetRequest rule carrying it would have to be rewritten each time - only
// the User-Agent, which never changes, is rewritten that way
enum QueryParameter {
  SubscriptionKey = "Ocp-Apim-Subscription-Key",
  SecMsGec = "Sec-MS-GEC",
  SecMsGecVersion = "Sec-MS-GEC-Version",
  ConnectionId = "ConnectionId"
}

// Ours: the default is "blob", which Edge's audioStreamer.js reads through a FileReader - a DataView
// over an ArrayBuffer gets at the header length without that detour
// https://developer.mozilla.org/docs/Web/API/WebSocket/binaryType
const SOCKET_BINARY_TYPE = "arraybuffer";

// 1000 is the spec's normal closure, the code audioStreamer.js closes a finished stream with
// https://developer.mozilla.org/docs/Web/API/CloseEvent/code
const NORMAL_CLOSURE_CODE = 1000;
const ABORT_EVENT = "abort";

interface SynthesizeOptions {
  text: string;
  voice: string;
  prosody: Prosody;
  onAudio: (chunk: Uint8Array<ArrayBuffer>) => void;
  onWordBoundary?: (boundary: WordBoundary) => void;
  signal?: AbortSignal;
  outputFormat?: OutputFormat;
  openSocket?: (url: string) => WebSocket;
}

async function createSynthesizeUrl() {
  const parameters = new URLSearchParams({
    [QueryParameter.SubscriptionKey]: TRUSTED_CLIENT_TOKEN,
    [QueryParameter.SecMsGec]: await secMsGec(),
    [QueryParameter.SecMsGecVersion]: SEC_MS_GEC_VERSION,
    [QueryParameter.ConnectionId]: createId()
  });
  return `${SYNTHESIZE_URL}?${parameters}`;
}

// Streams one request and resolves on turn.end. The gateway turns down anything whose User-Agent does
// not say Edge, which the browser sets itself - the extension rewrites it with declarativeNetRequest,
// Node passes openEdgeSocket
export async function synthesize({
  text,
  voice,
  prosody,
  onAudio,
  onWordBoundary,
  signal,
  outputFormat,
  openSocket = url => new WebSocket(url)
}: SynthesizeOptions) {
  signal?.throwIfAborted();
  const socket = openSocket(await createSynthesizeUrl());
  socket.binaryType = SOCKET_BINARY_TYPE;

  return new Promise<void>((resolve, reject) => {
    let isFinished = false;

    function finish(error?: unknown) {
      if (isFinished) {
        return;
      }

      isFinished = true;
      signal?.removeEventListener(ABORT_EVENT, onAbort);
      const isOpenOrConnecting = socket.readyState <= WebSocket.OPEN;
      if (isOpenOrConnecting) {
        socket.close(NORMAL_CLOSURE_CODE);
      }

      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    }

    function onAbort() {
      finish(signal?.reason);
    }

    function handleTextFrame(data: string) {
      const frame = parseTextFrame(data);
      if (frame.path === FramePath.TurnEnd) {
        finish();
        return;
      }

      const isWordMetadata = frame.path === FramePath.AudioMetadata && onWordBoundary !== undefined;
      if (!isWordMetadata) {
        return;
      }

      for (const boundary of parseWordBoundaries(frame.body)) {
        onWordBoundary(boundary);
      }
    }

    function handleBinaryFrame(data: ArrayBuffer) {
      const frame = parseBinaryFrame(data);
      const hasAudio = frame.path === FramePath.Audio && frame.audio.byteLength > 0;
      if (hasAudio) {
        onAudio(frame.audio);
      }
    }

    signal?.addEventListener(ABORT_EVENT, onAbort);

    socket.onopen = () => {
      socket.send(configMessage(outputFormat));
      socket.send(
        ssmlMessage({
          requestId: createId(),
          ssml: buildSsml({
            text,
            voice,
            prosody
          })
        })
      );
    };
    socket.onmessage = e => {
      if (typeof e.data === "string") {
        handleTextFrame(e.data);
        return;
      }

      handleBinaryFrame(e.data);
    };
    socket.onerror = () => finish(new Error("The Read Aloud service refused the connection"));
    socket.onclose = e => finish(new Error(`Connection dropped before the audio finished (${e.code})`));
  });
}
