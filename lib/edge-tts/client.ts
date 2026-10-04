import {
  SEC_MS_GEC_VERSION,
  SYNTHESIZE_URL,
  TRUSTED_CLIENT_TOKEN,
  VOICES_URL,
} from './constants';
import { secMsGec } from './gec';
import {
  configMessage,
  newId,
  parseBinaryFrame,
  parseTextFrame,
  parseWordBoundaries,
  ssmlMessage,
  type WordBoundary,
} from './protocol';
import { buildSsml, type Prosody } from './ssml';

export async function synthesizeUrl(): Promise<string> {
  const params = new URLSearchParams({
    TrustedClientToken: TRUSTED_CLIENT_TOKEN,
    'Sec-MS-GEC': await secMsGec(),
    'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
    ConnectionId: newId(),
  });
  return `${SYNTHESIZE_URL}?${params}`;
}

export interface SynthesizeHandlers {
  onAudio: (chunk: Uint8Array) => void;
  onWordBoundary?: (boundary: WordBoundary) => void;
  signal?: AbortSignal;
}

/**
 * Streams one request: opens a socket, sends config + SSML, forwards audio
 * and word boundaries as they arrive, and resolves on turn.end.
 *
 * The browser sets Origin and User-Agent itself; in the extension they are
 * rewritten by declarativeNetRequest so the server accepts the handshake.
 */
export async function synthesize(
  text: string,
  voice: string,
  prosody: Prosody,
  { onAudio, onWordBoundary, signal }: SynthesizeHandlers,
): Promise<void> {
  signal?.throwIfAborted();
  const ws = new WebSocket(await synthesizeUrl());
  ws.binaryType = 'arraybuffer';

  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      if (ws.readyState <= WebSocket.OPEN) ws.close(1000);
      error === undefined ? resolve() : reject(error);
    };
    const onAbort = () => finish(signal!.reason);
    signal?.addEventListener('abort', onAbort);

    ws.onopen = () => {
      ws.send(configMessage());
      ws.send(ssmlMessage(newId(), buildSsml(text, voice, prosody)));
    };
    ws.onmessage = ({ data }) => {
      if (typeof data === 'string') {
        const frame = parseTextFrame(data);
        if (frame.path === 'audio.metadata' && onWordBoundary) {
          parseWordBoundaries(frame.body).forEach(onWordBoundary);
        } else if (frame.path === 'turn.end') {
          finish();
        }
        return;
      }
      const frame = parseBinaryFrame(data as ArrayBuffer);
      if (frame.path === 'audio' && frame.audio.byteLength > 0) {
        onAudio(frame.audio);
      }
    };
    ws.onerror = () =>
      finish(new Error('Read Aloud service refused the connection'));
    ws.onclose = (e) =>
      finish(new Error(`Connection closed before the audio finished (${e.code})`));
  });
}

export interface Voice {
  ShortName: string;
  FriendlyName: string;
  Locale: string;
  LocaleName: string;
  Gender: string;
}

export async function fetchVoices(): Promise<Voice[]> {
  const res = await fetch(
    `${VOICES_URL}?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`,
  );
  if (!res.ok) throw new Error(`Voice list request failed (${res.status})`);
  return res.json();
}
