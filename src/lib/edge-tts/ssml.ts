// Mirrors Edge's ssml.js: strip control characters, straighten typographic quotes, escape XML,
// wrap in <speak><voice><prosody>

// The five predefined entities of XML 1.0 section 4.6, which is all the escaping an SSML body needs
// https://www.w3.org/TR/xml/#sec-predefined-ent
type XmlSpecialCharacter = "<" | ">" | "&" | "\"" | "'";
type XmlEntity = "&lt;" | "&gt;" | "&amp;" | "&quot;" | "&apos;";

const XML_ESCAPES: Record<XmlSpecialCharacter, XmlEntity> & Record<string, XmlEntity> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  "\"": "&quot;",
  "'": "&apos;"
};

// Edge's own ssml.js replaces each of these with the ASCII quote it stands for. Its list is a
// judgement call rather than a closed set, so the table is read by any character
type AsciiQuote = "'" | "\"";

const STRAIGHT_QUOTES: Record<string, AsciiQuote> = {
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

// Control characters other than tab/newline/carriage return break the service - Edge's ssml.js draws
// the same line, everything below tab plus everything between carriage return and space
const NON_WHITESPACE_CONTROL = /[\u0000-\u0008\u000E-\u001F]/g;
const XML_SPECIAL_CHARACTERS = new RegExp(`[${Object.keys(XML_ESCAPES).join("")}]`, "g");
const XML_UNESCAPES = Object.fromEntries(Object.entries(XML_ESCAPES).map(([character, entity]) => [entity, character]));
const XML_ENTITIES = new RegExp(Object.keys(XML_UNESCAPES).join("|"), "g");
const TYPOGRAPHIC_QUOTES = new RegExp(`[${Object.keys(STRAIGHT_QUOTES).join("")}]`, "g");

// The namespace W3C defines for SSML, written as Edge's ssml.js writes it, beside its version='1.0'
// https://www.w3.org/TR/speech-synthesis11/
const SSML_NAMESPACE = "http://www.w3.org/2001/10/synthesis";
const LOCALE_SEPARATOR = "-";
const VOICE_LOCALE_PARTS = 2;

// rate and volume travel as the documented relative percentage, pitch as a relative number of Hz -
// Edge's ssml.js converts its multipliers into the same two forms
// https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup-voice#adjust-prosody
const PERCENT = 100;

export interface Prosody {
  rate: number;
  volume: number;
  pitchHz: number;
}

// The neutral point, as Edge's ssml.js has it: rate and volume default to 1 and go out as +0%. Its
// pitch defaults to 1 too and it sends pitch minus 1 as Hz, which is the 0 Hz this stores directly
export const DEFAULT_PROSODY: Prosody = {
  rate: 1,
  volume: 1,
  pitchHz: 0
};

// "The rate changes should be within 0.5 to 2 times the original audio" - the documented prosody
// range, which the service enforces by clamping (research/README.md measures it)
// https://learn.microsoft.com/azure/ai-services/speech-service/speech-synthesis-markup-voice#adjust-prosody
export const RATE_RANGE = {
  min: 0.5,
  max: 2
} as const;

export function sanitizeText(text: string) {
  return text
    .replace(NON_WHITESPACE_CONTROL, " ")
    .replace(TYPOGRAPHIC_QUOTES, quote => STRAIGHT_QUOTES[quote] ?? quote);
}

function escapeXml(text: string) {
  return text.replace(XML_SPECIAL_CHARACTERS, character => XML_ESCAPES[character] ?? character);
}

// Word boundaries echo the spoken text as it was escaped in the SSML
export function unescapeXml(text: string) {
  return text.replace(XML_ENTITIES, entity => XML_UNESCAPES[entity] ?? entity);
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
  return voice.split(LOCALE_SEPARATOR).slice(0, VOICE_LOCALE_PARTS).join(LOCALE_SEPARATOR);
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
