// Frame formats on the Read Aloud WebSocket.
// Text frames:   "Header:value\r\n...\r\n\r\n<body>"
// Binary frames: u16 big-endian header length, header text, audio bytes.

import { OUTPUT_FORMAT, TICKS_PER_SECOND } from './constants';

/** Edge uses 32 random hex chars (a UUID without dashes) for ids. */
export const newId = () => crypto.randomUUID().replaceAll('-', '');

// Edge sends Date.toString() with a stray "Z" appended; the server accepts it.
const timestamp = () => `${new Date().toString()}Z`;

export function configMessage(): string {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: 'false',
            wordBoundaryEnabled: 'true',
          },
          outputFormat: OUTPUT_FORMAT,
        },
      },
    },
  };
  return (
    `X-Timestamp:${timestamp()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    JSON.stringify(config)
  );
}

export function ssmlMessage(requestId: string, ssml: string): string {
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp()}\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return headers;
}

export interface TextFrame {
  path: string;
  headers: Record<string, string>;
  body: string;
}

export function parseTextFrame(data: string): TextFrame {
  const split = data.indexOf('\r\n\r\n');
  const headers = parseHeaders(split < 0 ? data : data.slice(0, split));
  return {
    path: headers.Path ?? '',
    headers,
    body: split < 0 ? '' : data.slice(split + 4),
  };
}

export interface BinaryFrame {
  path: string;
  audio: Uint8Array<ArrayBuffer>;
}

export function parseBinaryFrame(buffer: ArrayBuffer): BinaryFrame {
  const headerLength = new DataView(buffer).getUint16(0);
  const header = new TextDecoder().decode(
    new Uint8Array(buffer, 2, headerLength),
  );
  return {
    path: parseHeaders(header).Path ?? '',
    audio: new Uint8Array(buffer, 2 + headerLength),
  };
}

export interface WordBoundary {
  /** Seconds from the start of this request's audio. */
  time: number;
  duration: number;
  text: string;
}

interface MetadataJson {
  Metadata: {
    Type: string;
    Data: { Offset: number; Duration: number; text: { Text: string } };
  }[];
}

export function parseWordBoundaries(body: string): WordBoundary[] {
  const json = JSON.parse(body) as MetadataJson;
  return json.Metadata.filter((m) => m.Type === 'WordBoundary').map((m) => ({
    time: m.Data.Offset / TICKS_PER_SECOND,
    duration: m.Data.Duration / TICKS_PER_SECOND,
    text: m.Data.text.Text,
  }));
}
