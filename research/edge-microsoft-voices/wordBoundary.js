// Copyright (C) Microsoft Corporation. All rights reserved.

class WordBoundary {

  constructor(timeOffset, text, length) {
    this.timeOffset = timeOffset;
    this.text = text;
    this.length = length;
  }

  static getWordBoundaries(rawString) {
    const jsonIndex = rawString.indexOf('{');
    const jsonString = rawString.substr(jsonIndex);
    const metaDataJson = JSON.parse(jsonString);
    const wordBoundaries = [];
    metaDataJson.Metadata.forEach(
        WordBoundary._extractWordBoundary.bind(this, wordBoundaries));
    return wordBoundaries;
  }

  static _extractWordBoundary(wordBoundaries, json) {
    if (WordBoundary._isValidBoundary(json)) {
      const wordBoundary = new WordBoundary(
        json.Data.Offset,
        json.Data.text.Text,
        json.Data.text.Length);
      wordBoundaries.push(wordBoundary);
    }
  }

  static _isValidBoundary(json) {
    return json.Type === 'WordBoundary' &&
      json.hasOwnProperty('Data') &&
      json.Data.hasOwnProperty('Offset') &&
      json.Data.hasOwnProperty('text') &&
      json.Data.text.hasOwnProperty('Text') &&
      json.Data.text.hasOwnProperty('Length');
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.WordBoundary = WordBoundary;
