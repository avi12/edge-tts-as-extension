import type { Voice } from "./voice-list";

// Scripts that name their language outright - Latin is shared by too many languages to guess from
const SCRIPT_LANGUAGES = [
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/gu, "ja"],
  [/\p{Script=Hebrew}/gu, "he"],
  [/\p{Script=Arabic}/gu, "ar"],
  [/\p{Script=Cyrillic}/gu, "ru"],
  [/\p{Script=Greek}/gu, "el"],
  [/\p{Script=Hangul}/gu, "ko"],
  [/\p{Script=Han}/gu, "zh"],
  [/\p{Script=Thai}/gu, "th"],
  [/\p{Script=Devanagari}/gu, "hi"],
  [/\p{Script=Armenian}/gu, "hy"],
  [/\p{Script=Georgian}/gu, "ka"]
] as const;
const LATIN_LETTER = /\p{Script=Latin}/gu;
const LOCALE_SEPARATOR = "-";
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i;

function countMatches({ text, pattern }: {
  text: string;
  pattern: RegExp;
}) {
  return text.match(pattern)?.length ?? 0;
}

// The language whose script most of the letters are written in, or null when Latin (or nothing) wins
export function detectLanguage(text: string) {
  let detectedLanguage: string | null = null;
  let mostLetters = countMatches({
    text,
    pattern: LATIN_LETTER
  });
  for (const [pattern, language] of SCRIPT_LANGUAGES) {
    const letters = countMatches({
      text,
      pattern
    });
    if (letters > mostLetters) {
      detectedLanguage = language;
      mostLetters = letters;
    }
  }

  return detectedLanguage;
}

function getLanguage(locale: string) {
  return locale.split(LOCALE_SEPARATOR)[0]?.toLowerCase() ?? "";
}

// A bare language means its main region, e.g. fr is fr-FR and he is he-IL
function getLikelyLocale(locale: string) {
  if (!LANGUAGE_TAG.test(locale)) {
    return locale;
  }

  const { language, region } = new Intl.Locale(locale).maximize();
  return region ? `${language}${LOCALE_SEPARATOR}${region}` : language;
}

// Keeps the preferred voice when it already speaks the language, otherwise the closest voice that does:
// the exact locale asked for first, then the preferred voice's gender
export function pickVoice({ voices, locale, preferredVoice }: {
  voices: Voice[];
  locale: string;
  preferredVoice: string;
}) {
  const language = getLanguage(locale);
  const likelyLocale = getLikelyLocale(locale).toLowerCase();
  const preferred = voices.find(voice => voice.ShortName === preferredVoice);
  const isPreferredFluent = preferred !== undefined && getLanguage(preferred.Locale) === language;
  if (isPreferredFluent) {
    return preferredVoice;
  }

  function isExactLocale(voice: Voice) {
    return voice.Locale.toLowerCase() === likelyLocale;
  }

  function isSameGender(voice: Voice) {
    return voice.Gender === preferred?.Gender;
  }

  const fluentVoices = voices.filter(voice => getLanguage(voice.Locale) === language);
  const bestVoice = fluentVoices.find(voice => isExactLocale(voice) && isSameGender(voice))
    ?? fluentVoices.find(isExactLocale)
    ?? fluentVoices.find(isSameGender)
    ?? fluentVoices[0];
  return bestVoice?.ShortName ?? preferredVoice;
}
