// Mirrors Edge's ssml.js: strip control characters, straighten typographic quotes, escape XML,
// wrap in <speak><voice><prosody>

const XML_ESCAPES: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "\"": "&quot;",
  "'": "&apos;"
};

const STRAIGHT_QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‛": "'",
  "‚": "'",
  "′": "'",
  "“": "\"",
  "”": "\"",
  "„": "\"",
  "‟": "\"",
  "″": "\""
};

// Control characters other than tab/newline/carriage return break the service
const NON_WHITESPACE_CONTROL = /[\u0000-\u0008\u000E-\u001F]/g;
const XML_SPECIAL_CHARACTERS = new RegExp(`[${Object.keys(XML_ESCAPES).join("")}]`, "g");
const TYPOGRAPHIC_QUOTES = new RegExp(`[${Object.keys(STRAIGHT_QUOTES).join("")}]`, "g");

const SSML_NAMESPACE = "http://www.w3.org/2001/10/synthesis";
const VOICE_LOCALE_PARTS = 2;
const PERCENT = 100;

export interface Prosody {
  rate: number;
  volume: number;
  pitchHz: number;
}

export const DEFAULT_PROSODY: Prosody = {
  rate: 1,
  volume: 1,
  pitchHz: 0
};

export function sanitizeText(text: string) {
  return text
    .replace(NON_WHITESPACE_CONTROL, " ")
    .replace(TYPOGRAPHIC_QUOTES, quote => STRAIGHT_QUOTES[quote] ?? quote);
}

function escapeXml(text: string) {
  return text.replace(XML_SPECIAL_CHARACTERS, character => XML_ESCAPES[character] ?? character);
}

function formatSigned({ value, unit }: {
  value: number;
  unit: string;
}) {
  const sign = value < 0 ? "" : "+";
  return `${sign}${Math.round(value)}${unit}`;
}

function formatRelativePercent(multiplier: number) {
  return formatSigned({
    value: (multiplier - 1) * PERCENT,
    unit: "%"
  });
}

// A voice's short name starts with its locale, e.g. "en-US-AriaNeural"
function getVoiceLocale(voice: string) {
  return voice.split("-").slice(0, VOICE_LOCALE_PARTS).join("-");
}

export function buildSsml({ text, voice, prosody = DEFAULT_PROSODY }: {
  text: string;
  voice: string;
  prosody?: Prosody;
}) {
  const pitch = formatSigned({
    value: prosody.pitchHz,
    unit: "Hz"
  });
  const rate = formatRelativePercent(prosody.rate);
  const volume = formatRelativePercent(prosody.volume);
  return `<speak version='1.0' xmlns='${SSML_NAMESPACE}' xml:lang='${getVoiceLocale(voice)}'>`
    + `<voice name='${voice}'>`
    + `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>`
    + escapeXml(sanitizeText(text))
    + `</prosody></voice></speak>`;
}
