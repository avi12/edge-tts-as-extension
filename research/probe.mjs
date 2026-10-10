// Probes the live Read Aloud service: which credentials the CETO gateway accepts, and one full
// synthesis that writes the audio out
// Usage: node research/probe.mjs
import crypto from "node:crypto";
import fs from "node:fs";

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SYNTHESIZE_URL = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1";
// Retired in Edge 155: it answers 403 to every handshake now
const BING_SYNTHESIZE_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600;
const TOKEN_WINDOW_SECONDS = 300;
const TICKS_PER_SECOND = 10_000_000n;
const MILLISECONDS_PER_SECOND = 1000;
const TIMEOUT_MS = 8000;
const BINARY_HEADER_LENGTH_BYTES = 2;
const GEC_VERSION = "1-155.0.4283.45";
const OUTPUT_FORMAT = "webm-24khz-16bit-mono-opus";
const SAMPLE_PROBE = "A";
const DEFAULT_SAMPLE_PATH = "sample.webm";
const SAMPLE_TEXT = "Hello from the reverse engineered read aloud service.";
const ONE_WINDOW_MS = TOKEN_WINDOW_SECONDS * MILLISECONDS_PER_SECOND;

const SUBSCRIPTION_KEY_HEADER = "Ocp-Apim-Subscription-Key";
const GEC_HEADER = "Sec-MS-GEC";
const GEC_VERSION_HEADER = "Sec-MS-GEC-Version";
const USER_AGENT_HEADER = "User-Agent";

const EDGE_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const OUR_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const EDGE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0";
const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const PROBES = {
  A: {
    what: "key and token as headers, Edge User-Agent",
    userAgent: EDGE_USER_AGENT
  },
  B: {
    what: "no Origin, no User-Agent",
    isUserAgentSent: false
  },
  C: {
    what: "our own extension's Origin",
    userAgent: EDGE_USER_AGENT,
    origin: OUR_ORIGIN
  },
  D: {
    what: "Chrome User-Agent",
    userAgent: CHROME_USER_AGENT,
    origin: OUR_ORIGIN
  },
  E: {
    what: "no token",
    userAgent: EDGE_USER_AGENT,
    isGecSent: false
  },
  F: {
    what: "no subscription key",
    userAgent: EDGE_USER_AGENT,
    isKeySent: false
  },
  G: {
    what: "key and token as query parameters, as the old endpoint took them",
    userAgent: EDGE_USER_AGENT,
    origin: EDGE_ORIGIN,
    isSentInQuery: true
  },
  H: {
    what: "token from two windows ago",
    userAgent: EDGE_USER_AGENT,
    tokenAgeMs: -2 * ONE_WINDOW_MS
  },
  I: {
    what: "token from one window ago",
    userAgent: EDGE_USER_AGENT,
    tokenAgeMs: -ONE_WINDOW_MS
  },
  J: {
    what: "the retired speech.platform.bing.com endpoint, the way it used to be called",
    userAgent: EDGE_USER_AGENT,
    origin: EDGE_ORIGIN,
    isSentInQuery: true,
    url: BING_SYNTHESIZE_URL
  }
};

function createGec(nowMs) {
  let seconds = Math.floor(nowMs / MILLISECONDS_PER_SECOND) + WINDOWS_EPOCH_OFFSET_SECONDS;
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

function createUrl({ url, isSentInQuery, isKeySent, isGecSent, gec }) {
  const parameters = new URLSearchParams({ ConnectionId: createId() });
  if (isSentInQuery && isKeySent) {
    parameters.set("TrustedClientToken", TOKEN);
    parameters.set(SUBSCRIPTION_KEY_HEADER, TOKEN);
  }

  if (isSentInQuery && isGecSent) {
    parameters.set(GEC_HEADER, gec);
    parameters.set(GEC_VERSION_HEADER, GEC_VERSION);
  }

  return `${url}?${parameters}`;
}

function createHeaders({ isSentInQuery, isKeySent, isGecSent, isUserAgentSent, userAgent, origin, gec }) {
  const headers = {};
  if (origin) {
    headers.Origin = origin;
  }

  if (isUserAgentSent) {
    headers[USER_AGENT_HEADER] = userAgent;
  }

  if (isSentInQuery) {
    return headers;
  }

  if (isKeySent) {
    headers[SUBSCRIPTION_KEY_HEADER] = TOKEN;
  }

  if (isGecSent) {
    headers[GEC_HEADER] = gec;
    headers[GEC_VERSION_HEADER] = GEC_VERSION;
  }

  return headers;
}

function createConfigMessage() {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "true"
          },
          outputFormat: OUTPUT_FORMAT
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
  what,
  url = SYNTHESIZE_URL,
  isSentInQuery = false,
  isKeySent = true,
  isGecSent = true,
  isUserAgentSent = true,
  userAgent = EDGE_USER_AGENT,
  origin,
  tokenAgeMs = 0
}) {
  const gec = createGec(Date.now() + tokenAgeMs);
  const settings = {
    isSentInQuery,
    isKeySent,
    isGecSent,
    isUserAgentSent,
    userAgent,
    origin,
    gec
  };
  const socket = new WebSocket(
    createUrl({
      url,
      ...settings
    }),
    { headers: createHeaders(settings) }
  );
  socket.binaryType = "arraybuffer";

  return new Promise(resolve => {
    let byteCount = 0;
    let wordMessageCount = 0;
    const audioChunks = [];
    function report(result) {
      resolve(`${name} ${result.padEnd(34)} ${what}`);
    }

    const timeoutId = setTimeout(() => {
      socket.close();
      report(`TIMEOUT bytes=${byteCount}`);
    }, TIMEOUT_MS);

    function finish(result) {
      clearTimeout(timeoutId);
      report(result);
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

      report(`OK bytes=${byteCount} wordMsgs=${wordMessageCount}`);
    }

    function handleBinaryMessage(data) {
      const headerLength = new DataView(data).getUint16(0);
      const audio = Buffer.from(data.slice(BINARY_HEADER_LENGTH_BYTES + headerLength));
      byteCount += audio.length;
      audioChunks.push(audio);
    }

    socket.onopen = () => {
      socket.send(createConfigMessage());
      socket.send(createSsmlMessage());
    };
    socket.onmessage = e => {
      if (typeof e.data === "string") {
        handleTextMessage(e.data);
        return;
      }

      handleBinaryMessage(e.data);
    };
    socket.onerror = () => finish("REFUSED (403 on the handshake)");
    socket.onclose = e => finish(`CLOSED ${e.code} ${e.reason} bytes=${byteCount}`);
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
