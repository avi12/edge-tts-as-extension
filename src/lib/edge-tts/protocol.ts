// Frame formats on the Read Aloud WebSocket
// Text frames: "Header:value\r\n...\r\n\r\n<body>"
// Binary frames: u16 big-endian header length, header text, audio bytes

import { OUTPUT_FORMAT, TICKS_PER_SECOND } from "./constants";
import { z } from "@/lib/zod";

export enum FramePath {
  SpeechConfig = "speech.config",
  Ssml = "ssml",
  AudioMetadata = "audio.metadata",
  TurnEnd = "turn.end",
  Audio = "audio"
}

enum Header {
  RequestId = "X-RequestId",
  Timestamp = "X-Timestamp",
  ContentType = "Content-Type",
  Path = "Path"
}

const LINE_BREAK = "\r\n";
const HEADER_SEPARATOR = ":";
const HEADER_BODY_SEPARATOR = `${LINE_BREAK}${LINE_BREAK}`;
const BINARY_HEADER_LENGTH_BYTES = 2;
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SSML_CONTENT_TYPE = "application/ssml+xml";
const WORD_BOUNDARY_TYPE = "WordBoundary";

const metadataSchema = z.object({
  Metadata: z.array(
    z.object({
      Type: z.string(),
      Data: z.unknown()
    })
  )
});

const wordBoundaryDataSchema = z.object({
  Offset: z.number(),
  Duration: z.number(),
  text: z.object({ Text: z.string() })
});

export interface WordBoundary {
  time: number;
  duration: number;
  text: string;
}

// Edge uses 32 random hex characters (a UUID without dashes) for ids
export function createId() {
  return crypto.randomUUID().replaceAll("-", "");
}

// Edge sends Date.toString() with a stray "Z" appended - the server accepts it
function createTimestamp() {
  return `${new Date().toString()}Z`;
}

function formatTextFrame({ headers, body }: {
  headers: Record<string, string>;
  body: string;
}) {
  let head = "";
  for (const [name, value] of Object.entries(headers)) {
    head += `${name}${HEADER_SEPARATOR}${value}${LINE_BREAK}`;
  }

  return `${head}${LINE_BREAK}${body}`;
}

export function configMessage(outputFormat = OUTPUT_FORMAT) {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "true"
          },
          outputFormat
        }
      }
    }
  };
  return formatTextFrame({
    headers: {
      [Header.Timestamp]: createTimestamp(),
      [Header.ContentType]: JSON_CONTENT_TYPE,
      [Header.Path]: FramePath.SpeechConfig
    },
    body: JSON.stringify(config)
  });
}

export function ssmlMessage({ requestId, ssml }: {
  requestId: string;
  ssml: string;
}) {
  return formatTextFrame({
    headers: {
      [Header.RequestId]: requestId,
      [Header.ContentType]: SSML_CONTENT_TYPE,
      [Header.Timestamp]: createTimestamp(),
      [Header.Path]: FramePath.Ssml
    },
    body: ssml
  });
}

function parseHeaders(block: string) {
  const headers: Record<string, string> = {};
  for (const line of block.split(LINE_BREAK)) {
    const iSeparator = line.indexOf(HEADER_SEPARATOR);
    if (iSeparator > 0) {
      headers[line.slice(0, iSeparator)] = line.slice(iSeparator + 1).trim();
    }
  }

  return headers;
}

export function parseTextFrame(data: string) {
  const iSeparator = data.indexOf(HEADER_BODY_SEPARATOR);
  const hasBody = iSeparator >= 0;
  const headers = parseHeaders(hasBody ? data.slice(0, iSeparator) : data);
  return {
    path: headers[Header.Path] ?? "",
    headers,
    body: hasBody ? data.slice(iSeparator + HEADER_BODY_SEPARATOR.length) : ""
  };
}

export function parseBinaryFrame(buffer: ArrayBuffer) {
  const headerLength = new DataView(buffer).getUint16(0);
  const header = new TextDecoder().decode(new Uint8Array(buffer, BINARY_HEADER_LENGTH_BYTES, headerLength));
  return {
    path: parseHeaders(header)[Header.Path] ?? "",
    audio: new Uint8Array(buffer, BINARY_HEADER_LENGTH_BYTES + headerLength)
  };
}

export function parseWordBoundaries(body: string) {
  const { Metadata: metadata } = metadataSchema.parse(JSON.parse(body));
  const boundaries: WordBoundary[] = [];
  for (const { Type: type, Data: data } of metadata) {
    if (type !== WORD_BOUNDARY_TYPE) {
      continue;
    }

    const { Offset: offset, Duration: duration, text } = wordBoundaryDataSchema.parse(data);
    boundaries.push({
      time: offset / TICKS_PER_SECOND,
      duration: duration / TICKS_PER_SECOND,
      text: text.Text
    });
  }

  return boundaries;
}
