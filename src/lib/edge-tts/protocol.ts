// Frame formats on the Read Aloud WebSocket, recovered from Edge's audioStreamer.js - the exchange is
// listed in research/README.md
// Text frames: "Header:value\r\n...\r\n\r\n<body>"
// Binary frames: u16 big-endian header length, header text, audio bytes

import { DEFAULT_OUTPUT_FORMAT, TICKS_PER_SECOND } from "./constants";
import { unescapeXml } from "./ssml";
import { z } from "@/lib/zod";

// The paths audioStreamer.js sends (speech.config, ssml) and the ones it looks for in what comes back
export enum FramePath {
  SpeechConfig = "speech.config",
  Ssml = "ssml",
  AudioMetadata = "audio.metadata",
  TurnEnd = "turn.end",
  Audio = "audio"
}

// The header names audioStreamer.js writes into its frames, spelling and case included
// Path, X-RequestId and X-Timestamp are this socket's framing alone - no Microsoft page mentions them.
// Content-Type is the HTTP header of that name, reused inside a text frame
// https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Content-Type
enum Header {
  RequestId = "X-RequestId",
  Timestamp = "X-Timestamp",
  ContentType = "Content-Type",
  Path = "Path"
}

// The frame grammar audioStreamer.js writes and reads: CRLF between headers, a blank line before the
// body, and its HEADER_LENGTH_BYTES in front of every binary frame
const LINE_BREAK = "\r\n";
const HEADER_SEPARATOR = ":";
const HEADER_BODY_SEPARATOR = `${LINE_BREAK}${LINE_BREAK}`;
const BINARY_HEADER_LENGTH_BYTES = 2;
// The two content types Edge's frames declare, verbatim. application/ssml+xml is the one the REST
// reference documents for an SSML body, same service, other front door; the JSON one carries
// speech.config, which nothing published describes
// https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
const SSML_CONTENT_TYPE = "application/ssml+xml";

// The metadata type Edge's wordBoundary.js keeps - it drops every entry of any other type
// Azure's SDK raises the same thing as a WordBoundary event, so the concept is documented while this
// envelope's spelling of it is not
// https://learn.microsoft.com/azure/ai-services/speech-service/how-to-speech-synthesis#subscribe-to-synthesizer-events
const WORD_BOUNDARY_TYPE = "WordBoundary";

// The envelope wordBoundary.js parses: Metadata entries, each a Type and its Data
const metadataSchema = z.object({
  Metadata: z.array(
    z.object({
      Type: z.string(),
      Data: z.unknown()
    })
  )
});

// Offset and text.Text are the fields wordBoundary.js reads; Duration rides along in the same payload,
// which Edge ignores. The SDK event above documents the same three under longer names - AudioOffset,
// Duration and Text - and says offsets arrive "in ticks", the 100 ns unit TICKS_PER_SECOND divides by
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

// Edge uses 32 random hex characters (a UUID without dashes) for ids - its uuid.js hexes 16 random bytes
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

export function configMessage(outputFormat = DEFAULT_OUTPUT_FORMAT) {
  // The speech.config body Edge's config.js sends, down to the lower-case metadataoptions and the
  // booleans it quotes as strings - the service takes them as strings on this socket, and no Microsoft
  // page names any of these fields. Only the outputFormat values are published, and there as the
  // X-Microsoft-OutputFormat request header of the REST front door (OutputFormat in constants.ts)
  // https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
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
      text: unescapeXml(text.Text)
    });
  }

  return boundaries;
}
