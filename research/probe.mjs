// Probes the live Read Aloud service with different header combinations.
// Usage: node research/probe.mjs
import crypto from 'crypto'; import fs from 'fs';
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const gec = () => { let t = Math.floor(Date.now()/1000) + 11644473600; t -= t % 300; return crypto.createHash('sha256').update(`${BigInt(t)*10000000n}${TOKEN}`).digest('hex').toUpperCase(); };
const uuid = () => crypto.randomUUID().replaceAll('-','');
async function probe(name, { useGec=true, origin, ua, version='1-154.0.4258.53', fmt='webm-24khz-16bit-mono-opus' }) {
  let url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${uuid()}`;
  if (useGec) url += `&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=${version}`;
  const headers = {}; if (origin) headers.Origin = origin; if (ua) headers['User-Agent'] = ua;
  return new Promise(res => {
    const ws = new WebSocket(url, { headers });
    ws.binaryType = 'arraybuffer';
    let bytes = 0, words = 0; const chunks=[];
    const t = setTimeout(() => { ws.close(); res(`${name}: TIMEOUT bytes=${bytes}`); }, 8000);
    ws.onopen = () => {
      ws.send(`X-Timestamp:${new Date().toString()}Z\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` + JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:'false',wordBoundaryEnabled:'true'},outputFormat:fmt}}}}));
      ws.send(`X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-AriaNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>Hello from the reverse engineered read aloud service.</prosody></voice></speak>`);
    };
    ws.onmessage = e => {
      if (typeof e.data === 'string') { if (e.data.includes('WordBoundary')) words++; if (e.data.includes('Path:turn.end')) { clearTimeout(t); ws.close(); if (name==='A') fs.writeFileSync(process.env.OUT ?? "sample.webm", Buffer.concat(chunks)); res(`${name}: OK bytes=${bytes} wordMsgs=${words}`); } }
      else { const dv = new DataView(e.data); const hl = dv.getUint16(0); const body = Buffer.from(e.data.slice(2+hl)); bytes += body.length; chunks.push(body); }
    };
    ws.onerror = e => { clearTimeout(t); res(`${name}: ERROR ${e.message ?? e.type}`); };
    ws.onclose = e => { clearTimeout(t); res(`${name}: CLOSED ${e.code} ${e.reason} bytes=${bytes}`); };
  });
}
const EDGE_ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
for (const [n,o] of Object.entries({
  A: { origin: EDGE_ORIGIN, ua: EDGE_UA },
  B: { origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', ua: CHROME_UA },
  C: { ua: CHROME_UA },
  D: { useGec: false, origin: EDGE_ORIGIN, ua: EDGE_UA },
  E: { origin: EDGE_ORIGIN, ua: EDGE_UA, version: '1-130.0.2849.68' },
  F: { origin: EDGE_ORIGIN, ua: EDGE_UA, fmt: 'audio-24khz-48kbitrate-mono-mp3' },
})) console.log(await probe(n, o));
