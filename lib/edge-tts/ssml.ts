// Mirrors Edge's ssml.js: strip control characters, straighten typographic
// quotes, escape XML, wrap in <speak><voice><prosody>.

const XML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
};

const STRAIGHT_QUOTES: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‛': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '″': '"',
};

// Control characters other than tab/newline/carriage return break the service.
// eslint-disable-next-line no-control-regex
const NON_WHITESPACE_CONTROL = /[\u0000-\u0008\u000E-\u001F]/g;

export function sanitizeText(text: string): string {
  return text
    .replace(NON_WHITESPACE_CONTROL, ' ')
    .replace(/[‘’‛‚′“”„‟″]/g, (c) => STRAIGHT_QUOTES[c] ?? c);
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => XML_ESCAPES[c] ?? c);
}

export interface Prosody {
  /** 1 = normal speed. */
  rate: number;
  /** 1 = normal volume. */
  volume: number;
  /** Offset in Hz; 0 = normal pitch. */
  pitchHz: number;
}

export const DEFAULT_PROSODY: Prosody = { rate: 1, volume: 1, pitchHz: 0 };

const signed = (n: number, unit: string) =>
  `${n < 0 ? '' : '+'}${Math.round(n)}${unit}`;

/** The voice's short name is also its locale prefix, e.g. "en-US-AriaNeural". */
const localeOf = (voice: string) => voice.split('-').slice(0, 2).join('-');

export function buildSsml(
  text: string,
  voice: string,
  prosody: Prosody = DEFAULT_PROSODY,
): string {
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${localeOf(voice)}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${signed(prosody.pitchHz, 'Hz')}' rate='${signed((prosody.rate - 1) * 100, '%')}' volume='${signed((prosody.volume - 1) * 100, '%')}'>` +
    escapeXml(sanitizeText(text)) +
    `</prosody></voice></speak>`
  );
}
