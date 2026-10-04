// Probes the live Read Aloud service with different header combinations
// Usage: node research/probe.mjs
import crypto from "node:crypto";
import fs from "node:fs";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SYNTHESIZE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const TOKEN_WINDOW_SECONDS = 300;
const TICKS_PER_SECOND = 10_000_000n;
const MILLISECONDS_PER_SECOND = 1000;
const TIMEOUT_MS = 8000;
const BINARY_HEADER_LENGTH_BYTES = 2;
const DEFAULT_GEC_VERSION = "1-154.0.4258.53";
const DEFAULT_OUTPUT_FORMAT = "webm-24khz-16bit-mono-opus";
const SAMPLE_PROBE = "A";
const DEFAULT_SAMPLE_PATH = "sample.webm";
const SAMPLE_TEXT = "Hello from the reverse engineered read aloud service.";

const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const EDGE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0";
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const PROBES = {
  A: {
    origin: EDGE_ORIGIN,
    userAgent: EDGE_USER_AGENT
  },
  B: {
    origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    userAgent: CHROME_USER_AGENT
  },
  C: {
    userAgent: CHROME_USER_AGENT
  },
  D: {
    isGecSent: false,
    origin: EDGE_ORIGIN,
    userAgent: EDGE_USER_AGENT
  },
  E: {
    origin: EDGE_ORIGIN,
    userAgent: EDGE_USER_AGENT,
    gecVersion: "1-130.0.2849.68"
  },
  F: {
    origin: EDGE_ORIGIN,
    userAgent: EDGE_USER_AGENT,
    outputFormat: "audio-24khz-48kbitrate-mono-mp3"
  }
};

function createGec() {
  let seconds = Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + WINDOWS_EPOCH_OFFSET_SECONDS;
  seconds -= seconds % TOKEN_WINDOW_SECONDS;
  return crypto
    .createHash("sha256")
    .update(`${BigInt(seconds) * TICKS_PER_SECOND}${TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

function createId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function createUrl({ isGecSent, gecVersion }) {
  const url = `${SYNTHESIZE_URL}?TrustedClientToken=${TOKEN}&ConnectionId=${createId()}`;
  if (!isGecSent) {
    return url;
  }

  return `${url}&Sec-MS-GEC=${createGec()}&Sec-MS-GEC-Version=${gecVersion}`;
}

function createHeaders({ origin, userAgent }) {
  const headers = {};
  if (origin) {
    headers.Origin = origin;
  }

  if (userAgent) {
    headers["User-Agent"] = userAgent;
  }

  return headers;
}

function createConfigMessage(outputFormat) {
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
  return `X-Timestamp:${new Date().toString()}Z\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(config)}`;
}

function createSsmlMessage() {
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-AriaNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${SAMPLE_TEXT}</prosody></voice></speak>`;
  return `X-RequestId:${createId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
}

function probe({
  name,
  isGecSent = true,
  origin,
  userAgent,
  gecVersion = DEFAULT_GEC_VERSION,
  outputFormat = DEFAULT_OUTPUT_FORMAT
}) {
  const url = createUrl({
    isGecSent,
    gecVersion
  });
  const headers = createHeaders({
    origin,
    userAgent
  });
  return new Promise(resolve => {
    const socket = new WebSocket(url, { headers });
    socket.binaryType = "arraybuffer";
    let byteCount = 0;
    let wordMessageCount = 0;
    const audioChunks = [];
    const timeoutId = setTimeout(() => {
      socket.close();
      resolve(`${name}: TIMEOUT bytes=${byteCount}`);
    }, TIMEOUT_MS);

    function finish(result) {
      clearTimeout(timeoutId);
      resolve(result);
    }

    function handleTextMessage(data) {
      if (data.includes("WordBoundary")) {
        wordMessageCount++;
      }

      if (!data.includes("Path:turn.end")) {
        return;
      }

      clearTimeout(timeoutId);
      socket.close();

      if (name === SAMPLE_PROBE) {
        fs.writeFileSync(process.env.OUT ?? DEFAULT_SAMPLE_PATH, Buffer.concat(audioChunks));
      }

      resolve(`${name}: OK bytes=${byteCount} wordMsgs=${wordMessageCount}`);
    }

    function handleBinaryMessage(data) {
      const headerLength = new DataView(data).getUint16(0);
      const audio = Buffer.from(data.slice(BINARY_HEADER_LENGTH_BYTES + headerLength));
      byteCount += audio.length;
      audioChunks.push(audio);
    }

    socket.onopen = () => {
      socket.send(createConfigMessage(outputFormat));
      socket.send(createSsmlMessage());
    };
    socket.onmessage = e => {
      if (typeof e.data === "string") {
        handleTextMessage(e.data);
        return;
      }

      handleBinaryMessage(e.data);
    };
    socket.onerror = e => finish(`${name}: ERROR ${e.message ?? e.type}`);
    socket.onclose = e => finish(`${name}: CLOSED ${e.code} ${e.reason} bytes=${byteCount}`);
  });
}

for (const [name, options] of Object.entries(PROBES)) {
  console.log(
    await probe({
      name,
      ...options
    })
  );
}
