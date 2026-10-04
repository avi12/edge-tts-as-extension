// Copyright (C) Microsoft Corporation. All rights reserved.

const DEFAULT_VOICE_NAME = 'ZiraRUS';
const DEFAULT_LANGUAGE = 'en-US';
const DEFAULT_RATE = 1.0;
const DEFAULT_PITCH = 1.0;
const DEFAULT_VOLUME = 1.0;

const ESCAPABLE_CHARACTERS_EXPRESSION = /<|>|&|"|'/g;
const ESCAPE_CHARACTERS_EXPRESSION = /&lt;|&gt;|&amp;|&quot;|&apos;/g;
const NON_STANDARD_CHARACTERS_EXPRESSION = /‘|’|‛|“|”|„|‟|′|″/g;

const CHARACTER_TO_ESCAPE = {
  '<' : '&lt;',
  '>' : '&gt;',
  '&' : '&amp;',
  '"' : '&quot;',
  '\'' : '&apos;',
};
const ESCAPE_TO_CHARACTER = {
  '&lt;' : '<',
  '&gt;' : '>' ,
  '&amp;' : '&',
  '&quot;' : '"',
  '&apos;' : '\'',
};
const STANDARD_CONVERSION = {
  '‘' : '\'',
  '’' : '\'',
  '‛' : '\'',
  '‚' : '\'',
  '′' : '\'',
  '“' : '"',
  '”' : '"',
  '„' : '"',
  '‟' : '"',
  '″' : '"',
};

class Ssml {

  static createSsml(text, options) {
    Ssml._ensureDefaultOptions(options);
    const rateString =
        Ssml._getConvertedPercentageString(options.rate, DEFAULT_RATE);
    const pitchString = Ssml._getConvertedPitchString(options.pitch);
    const volumeString =
        Ssml._getConvertedPercentageString(options.volume, DEFAULT_VOLUME);
    const voiceName = Ssml.getVoiceName(options.voiceName);
    const language =
        ManifestHelper.getVoiceAttribute(voiceName, 'lang', DEFAULT_LANGUAGE);

    return '<speak version=\'1.0\' ' +
        'xmlns=\'http://www.w3.org/2001/10/synthesis\'  xml:lang=\'' + language +
        '\'>' + '<voice name=\'' + voiceName + '\'>' +
        '<prosody pitch=\'' + pitchString + '\' rate =\'' + rateString +
        '\' volume=\'' + volumeString + '\'>' + text +
        '</prosody></voice></speak>';
  }

  static formatRawText(text) {
    return text.replace(
        ESCAPABLE_CHARACTERS_EXPRESSION,
        Ssml._replaceEscapableCharacter.bind(this));
  }

  // The service can't handle control characters that are not whitespace, and
  // non-whitespace control characters are not used for speech, so this function
  // helps us detect them so they can be removed.
  static _isNonWhiteSpaceControlCharacter(characterCode) {
    const horizontalTabCode = 9;
    const carriageReturnCode = 13;
    const spaceCode = 32;
    return ((characterCode >= 0) && (characterCode < horizontalTabCode)) ||
        ((characterCode > carriageReturnCode) && (characterCode < spaceCode));
  }

  static replaceNonstandardCharacters(text) {
    let i = 0;
    for (i = 0; i < text.length; ++i) {
      if (this._isNonWhiteSpaceControlCharacter(text.charCodeAt(i))) {
        text = text.replace(new RegExp(text[i], 'g'), ' ');
      }
    }

    return text.replace(
      NON_STANDARD_CHARACTERS_EXPRESSION,
      Ssml._replaceNonstandardCharacter.bind(this));
  }

  static revertFormattedText(formattedText) {
    return formattedText.replace(
        ESCAPE_CHARACTERS_EXPRESSION, Ssml._replaceEscapeCharacter.bind(this));
  }

  static getEscapeToCharacter() {
    return ESCAPE_TO_CHARACTER;
  }

  static getVoiceName(friendlyName) {
    let outputName = friendlyName;
    const voiceListSingleton = VoiceListSingleton.instance();
    if (voiceListSingleton.containsVoice(friendlyName)) {
      outputName = voiceListSingleton.getName(friendlyName);
    }
    return outputName;
  }

  static _ensureDefaultOptions(options) {
    if (!options.hasOwnProperty('voiceName')) {
      options['voiceName'] = DEFAULT_VOICE_NAME;
    }

    if (!options.hasOwnProperty('lang')) {
      options['lang'] = DEFAULT_LANGUAGE;
    }

    if (!options.hasOwnProperty('rate')) {
      options['rate'] = DEFAULT_RATE;
    }

    if (!options.hasOwnProperty('pitch')) {
      options['pitch'] = DEFAULT_PITCH;
    }

    if (!options.hasOwnProperty('volume')) {
      options['volume'] = DEFAULT_VOLUME;
    }
  }

  static _getConvertedPitchString(pitch) {
    const convertedPitch = (pitch - DEFAULT_PITCH);
    return convertedPitch < 0 ?
        convertedPitch + 'Hz' : '+' + convertedPitch + 'Hz';
  }

  static _getConvertedPercentageString(value, defaultValue) {
    const convertedPercentage = (value - defaultValue) * 100;
    return (convertedPercentage < 0) ?
        (convertedPercentage + '%') : (('+' + convertedPercentage) + '%');
  }

  static _replaceEscapableCharacter(character) {
    return CHARACTER_TO_ESCAPE[character];
  }

  static _replaceEscapeCharacter(escapeCharacter) {
    return ESCAPE_TO_CHARACTER[escapeCharacter];
  }

  static _replaceNonstandardCharacter(character) {
    return STANDARD_CONVERSION[character];
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.Ssml = Ssml;
