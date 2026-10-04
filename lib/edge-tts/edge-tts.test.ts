import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSsml,
  chunkText,
  EDGE_EXTENSION_ORIGIN,
  EDGE_USER_AGENT,
  fetchVoices,
  parseBinaryFrame,
  parseTextFrame,
  parseWordBoundaries,
  secMsGec,
  synthesize,
  TRUSTED_CLIENT_TOKEN,
  type WordBoundary,
} from '.';

describe('secMsGec', () => {
  it('hashes Windows file time rounded down to 5 minutes', async () => {
    const now = Date.UTC(2026, 9, 4, 12, 3, 59);
    // 12:03:59 rounds down to 12:00:00
    const rounded = BigInt(Date.UTC(2026, 9, 4, 12, 0, 0) / 1000 + 11644473600);
    const expected = createHash('sha256')
      .update(`${rounded * 10_000_000n}${TRUSTED_CLIENT_TOKEN}`)
      .digest('hex')
      .toUpperCase();
    expect(await secMsGec(now)).toBe(expected);
    expect(await secMsGec(now + 60_000)).toBe(expected);
    expect(await secMsGec(now + 61_000)).not.toBe(expected);
  });
});

describe('buildSsml', () => {
  it('escapes XML and straightens quotes', () => {
    const ssml = buildSsml('Tom & “Jerry” <3', 'en-US-AriaNeural');
    expect(ssml).toContain('Tom &amp; &quot;Jerry&quot; &lt;3');
    expect(ssml).toContain("xml:lang='en-US'");
  });

  it('converts prosody to signed whole units', () => {
    const ssml = buildSsml('x', 'de-DE-KatjaNeural', {
      rate: 1.2,
      volume: 0.5,
      pitchHz: -3,
    });
    expect(ssml).toContain("pitch='-3Hz' rate='+20%' volume='-50%'");
  });
});

describe('frames', () => {
  it('parses text frames', () => {
    const f = parseTextFrame('X-RequestId:abc\r\nPath:turn.end\r\n\r\n{}');
    expect(f).toMatchObject({ path: 'turn.end', body: '{}' });
  });

  it('parses binary frames', () => {
    const header = new TextEncoder().encode('Path:audio\r\n');
    const buf = new Uint8Array(2 + header.length + 3);
    new DataView(buf.buffer).setUint16(0, header.length);
    buf.set(header, 2);
    buf.set([7, 8, 9], 2 + header.length);
    const f = parseBinaryFrame(buf.buffer);
    expect(f.path).toBe('audio');
    expect([...f.audio]).toEqual([7, 8, 9]);
  });

  it('extracts word boundaries in seconds', () => {
    const body = JSON.stringify({
      Metadata: [
        { Type: 'WordBoundary', Data: { Offset: 1_000_000, Duration: 5_000_000, text: { Text: 'Hi' } } },
        { Type: 'SessionEnd', Data: {} },
      ],
    });
    expect(parseWordBoundaries(body)).toEqual([{ time: 0.1, duration: 0.5, text: 'Hi' }]);
  });
});

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('Hello there.')).toEqual([{ text: 'Hello there.', start: 0 }]);
  });

  it('splits at sentence ends and keeps offsets', () => {
    const text = 'One two three. Four five six. Seven eight nine.';
    const chunks = chunkText(text, 20);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(20);
      expect(text.slice(c.start, c.start + c.text.length)).toBe(c.text);
    }
  });

  it('hard-cuts text without spaces', () => {
    expect(chunkText('a'.repeat(25), 10).map((c) => c.text.length)).toEqual([10, 10, 5]);
  });
});

// Hits the real service. Node's WebSocket can set headers, which stands in for
// the declarativeNetRequest rewrite the extension does.
describe.runIf(process.env.LIVE)('live service', () => {
  it('lists voices', async () => {
    const voices = await fetchVoices();
    expect(voices.some((v) => v.ShortName === 'en-US-AriaNeural')).toBe(true);
  });

  it('streams audio and word boundaries', async () => {
    const Native = globalThis.WebSocket;
    vi.stubGlobal(
      'WebSocket',
      class extends Native {
        constructor(url: string) {
          // @ts-expect-error undici accepts a headers option
          super(url, { headers: { Origin: EDGE_EXTENSION_ORIGIN, 'User-Agent': EDGE_USER_AGENT } });
        }
      },
    );
    let bytes = 0;
    const words: WordBoundary[] = [];
    await synthesize('Hello from Chrome.', 'en-US-AriaNeural', { rate: 1, volume: 1, pitchHz: 0 }, {
      onAudio: (a) => (bytes += a.byteLength),
      onWordBoundary: (w) => words.push(w),
    });
    vi.unstubAllGlobals();
    expect(bytes).toBeGreaterThan(5000);
    expect(words.map((w) => w.text)).toEqual(['Hello', 'from', 'Chrome']);
  });
});
