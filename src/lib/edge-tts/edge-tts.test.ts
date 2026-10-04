import {
  buildSsml,
  chunkText,
  fetchVoices,
  parseBinaryFrame,
  parseTextFrame,
  parseWordBoundaries,
  secMsGec,
  synthesize,
  TRUSTED_CLIENT_TOKEN,
  type WordBoundary
} from ".";
import { openEdgeSocket } from "./node-socket";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const TICKS_PER_SECOND = 10_000_000n;
const MILLISECONDS_PER_SECOND = 1000;
const ONE_MINUTE_MS = 60_000;
const ONE_MINUTE_ONE_SECOND_MS = 61_000;
const BINARY_HEADER_LENGTH_BYTES = 2;
const AUDIO_BYTES = [7, 8, 9];
const SHORT_CHUNK_LENGTH = 20;
const HARD_CUT_LENGTH = 10;
const MIN_LIVE_AUDIO_BYTES = 5000;
const LIVE_VOICE = "en-US-AriaNeural";

describe("secMsGec", () => {
  it("hashes Windows file time rounded down to 5 minutes", async () => {
    const now = Date.UTC(2026, 9, 4, 12, 3, 59);
    const roundedDown = Date.UTC(2026, 9, 4, 12, 0, 0);
    const roundedSeconds = BigInt(roundedDown / MILLISECONDS_PER_SECOND + WINDOWS_EPOCH_OFFSET_SECONDS);
    const expected = createHash("sha256")
      .update(`${roundedSeconds * TICKS_PER_SECOND}${TRUSTED_CLIENT_TOKEN}`)
      .digest("hex")
      .toUpperCase();
    expect(await secMsGec(now)).toBe(expected);
    expect(await secMsGec(now + ONE_MINUTE_MS)).toBe(expected);
    expect(await secMsGec(now + ONE_MINUTE_ONE_SECOND_MS)).not.toBe(expected);
  });
});

describe("buildSsml", () => {
  it("escapes XML and straightens quotes", () => {
    const ssml = buildSsml({
      text: "Tom & “Jerry” <3",
      voice: "en-US-AriaNeural"
    });
    expect(ssml).toContain("Tom &amp; &quot;Jerry&quot; &lt;3");
    expect(ssml).toContain("xml:lang='en-US'");
  });

  it("converts prosody to signed whole units", () => {
    const ssml = buildSsml({
      text: "x",
      voice: "de-DE-KatjaNeural",
      prosody: {
        rate: 1.2,
        volume: 0.5,
        pitchHz: -3
      }
    });
    expect(ssml).toContain("pitch='-3Hz' rate='+20%' volume='-50%'");
  });
});

describe("frames", () => {
  it("parses text frames", () => {
    const frame = parseTextFrame("X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}");
    expect(frame).toMatchObject({
      path: "turn.end",
      body: "{}"
    });
  });

  it("parses binary frames", () => {
    const header = new TextEncoder().encode("Path:audio\r\n");
    const bytes = new Uint8Array(BINARY_HEADER_LENGTH_BYTES + header.length + AUDIO_BYTES.length);
    new DataView(bytes.buffer).setUint16(0, header.length);
    bytes.set(header, BINARY_HEADER_LENGTH_BYTES);
    bytes.set(AUDIO_BYTES, BINARY_HEADER_LENGTH_BYTES + header.length);
    const frame = parseBinaryFrame(bytes.buffer);
    expect(frame.path).toBe("audio");
    expect([...frame.audio]).toEqual(AUDIO_BYTES);
  });

  it("extracts word boundaries in seconds", () => {
    const body = JSON.stringify({
      Metadata: [
        {
          Type: "WordBoundary",
          Data: {
            Offset: 1_000_000,
            Duration: 5_000_000,
            text: {
              Text: "Hi"
            }
          }
        },
        {
          Type: "SessionEnd",
          Data: {}
        }
      ]
    });
    expect(parseWordBoundaries(body)).toEqual([
      {
        time: 0.1,
        duration: 0.5,
        text: "Hi"
      }
    ]);
  });
});

describe("chunkText", () => {
  it("keeps short text whole", () => {
    expect(chunkText({ text: "Hello there." })).toEqual([
      {
        text: "Hello there.",
        start: 0
      }
    ]);
  });

  it("splits at sentence ends and keeps offsets", () => {
    const text = "One two three. Four five six. Seven eight nine.";
    const chunks = chunkText({
      text,
      maxLength: SHORT_CHUNK_LENGTH
    });
    expect(chunks.map(chunk => chunk.text).join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(SHORT_CHUNK_LENGTH);
      expect(text.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
    }
  });

  it("hard-cuts text without spaces", () => {
    const chunks = chunkText({
      text: "a".repeat(25),
      maxLength: HARD_CUT_LENGTH
    });
    expect(chunks.map(chunk => chunk.text.length)).toEqual([10, 10, 5]);
  });
});

describe.runIf(process.env.LIVE)("live service", () => {
  it("lists voices", async () => {
    const voices = await fetchVoices();
    expect(voices.some(voice => voice.ShortName === LIVE_VOICE)).toBe(true);
  });

  it("streams audio and word boundaries", async () => {
    let byteCount = 0;
    const words: WordBoundary[] = [];
    await synthesize({
      text: "Hello from Chrome.",
      voice: LIVE_VOICE,
      prosody: {
        rate: 1,
        volume: 1,
        pitchHz: 0
      },
      onAudio(chunk) {
        byteCount += chunk.byteLength;
      },
      onWordBoundary: boundary => words.push(boundary),
      openSocket: openEdgeSocket
    });
    expect(byteCount).toBeGreaterThan(MIN_LIVE_AUDIO_BYTES);
    expect(words.map(word => word.text)).toEqual(["Hello", "from", "Chrome"]);
  });
});
