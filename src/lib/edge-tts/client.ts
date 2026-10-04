import { SEC_MS_GEC_VERSION, SYNTHESIZE_URL, TRUSTED_CLIENT_TOKEN, VOICES_URL } from "./constants";
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
import { z } from "@/lib/zod";

enum QueryParameter {
  TrustedClientToken = "TrustedClientToken",
  SecMsGec = "Sec-MS-GEC",
  SecMsGecVersion = "Sec-MS-GEC-Version",
  ConnectionId = "ConnectionId",
  VoicesTrustedClientToken = "trustedclienttoken"
}

const SOCKET_BINARY_TYPE = "arraybuffer";
const NORMAL_CLOSURE_CODE = 1000;
const ABORT_EVENT = "abort";

const voiceSchema = z.object({
  ShortName: z.string(),
  FriendlyName: z.string(),
  Locale: z.string(),
  LocaleName: z.string(),
  Gender: z.string()
});

const voicesSchema = z.array(voiceSchema);

export type Voice = z.infer<typeof voiceSchema>;

interface SynthesizeOptions {
  text: string;
  voice: string;
  prosody: Prosody;
  onAudio: (chunk: Uint8Array<ArrayBuffer>) => void;
  onWordBoundary?: (boundary: WordBoundary) => void;
  signal?: AbortSignal;
  outputFormat?: string;
  openSocket?: (url: string) => WebSocket;
}

async function createSynthesizeUrl() {
  const parameters = new URLSearchParams({
    [QueryParameter.TrustedClientToken]: TRUSTED_CLIENT_TOKEN,
    [QueryParameter.SecMsGec]: await secMsGec(),
    [QueryParameter.SecMsGecVersion]: SEC_MS_GEC_VERSION,
    [QueryParameter.ConnectionId]: createId()
  });
  return `${SYNTHESIZE_URL}?${parameters}`;
}

// Streams one request and resolves on turn.end. The browser sets Origin and User-Agent itself -
// the extension rewrites them with declarativeNetRequest, Node passes openEdgeSocket
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

export async function fetchVoices() {
  const parameters = new URLSearchParams({ [QueryParameter.VoicesTrustedClientToken]: TRUSTED_CLIENT_TOKEN });
  const response = await fetch(`${VOICES_URL}?${parameters}`);
  if (!response.ok) {
    throw new Error(`Couldn't get the voice list (${response.status})`);
  }

  return voicesSchema.parse(await response.json());
}
