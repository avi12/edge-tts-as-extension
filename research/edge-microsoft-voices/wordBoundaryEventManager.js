// Copyright (C) Microsoft Corporation. All rights reserved.

const TIME_CONVERSION_FACTOR = 10000;
const MILLI_CONVERSION_FACTOR = 1000;
const OFFSET_THRESHOLD = 1;

class WordBoundaryEventManager {
  constructor(audio, onWordBoundaryEvent, onError, uuidProvider) {
    this._audio = audio;
    this._onWordBoundaryEvent = onWordBoundaryEvent;
    this._onError = onError;
    this._uuidProvider = uuidProvider;
    this._wordBoundaries = [];
    this._timeout = null;
    this._utterance = null;
    this._searchIndex = 0;
  }

  addWordBoundaries(wordBoundaries) {
    this._wordBoundaries = this._wordBoundaries.concat(wordBoundaries);
    if (this._timeout === null) {
      this._attemptSetTimeout();
    }
  }

  pause() {
    if (this._timeout != null) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  resume() {
    this._attemptSetTimeout();
  }

  reset(audio) {
    if (this._timeout != null) {
      clearTimeout(this._timeout);
    }

    this._audio = audio;
    this._wordBoundaries = [];
    this._timeout = null;
    this._utterance = null;
    this._searchIndex = 0;
  }

  setUtterance(utterance) {
    this._utterance = utterance;
    this._searchIndex = 0;
  }

  _wordBoundaryOccured(timeOffset) {
    let wordBoundary = this._wordBoundaries[0];
    if (wordBoundary.timeOffset !== timeOffset) {
      const errorMessage = 'previous timeout was not cancelled';
      const error =
          this._createWordBoundaryError(
              errorMessage, TelemetryHelper.ErrorEnum().INTERNAL);
      this._onError(error, ErrorHelper.SYNTHESIS_FAILED_ERROR_CODE());
      return;
    }

    if (this._shouldResetTimeout(wordBoundary.timeOffset)) {
      this._attemptSetTimeout();
      return;
    }

    wordBoundary = this._formatWordBoundary(wordBoundary);
    const wordIndex =
        this._findWordIndex(wordBoundary.text, wordBoundary.length);
    if (wordIndex < 0) {
      const errorMessage = 'text from wordBoundary not found in utterance. '
          + this._uuidProvider.getUuid();
      const error =
          this._createWordBoundaryError(
              errorMessage, TelemetryHelper.ErrorEnum().SERVICE);
      this._onError(error, ErrorHelper.SYNTHESIS_FAILED_ERROR_CODE());
      return;
    }

    this._wordBoundaries.shift();
    this._timeout = null;
    this._onWordBoundaryEvent(wordIndex, wordBoundary.length);
    this._attemptSetTimeout();
  }

  _attemptSetTimeout() {
    if (this._wordBoundaries.length === 0) {
      return false;
    }

    const wordBoundary = this._wordBoundaries[0];
    const timeOutOffset = this._calculateTimeoutOffset(wordBoundary.timeOffset);
    this._timeout =
        setTimeout(this._wordBoundaryOccured.bind(
            this, wordBoundary.timeOffset), timeOutOffset);
    return true;
  }

  _findWordIndex(word, wordLength) {
    const wordIndex = this._utterance.indexOf(word, this._searchIndex);
    this._searchIndex = wordIndex + wordLength;
    return wordIndex;
  }

  _shouldResetTimeout(wordTimeOffset) {
    return this._calculateTimeoutOffset(wordTimeOffset) > OFFSET_THRESHOLD;
  }

  _calculateTimeoutOffset(wordTimeOffset) {
    return (wordTimeOffset / TIME_CONVERSION_FACTOR) -
        (this._audio.currentTime * MILLI_CONVERSION_FACTOR);
  }

  _formatWordBoundary(wordBoundary) {
    wordBoundary.text = Ssml.revertFormattedText(wordBoundary.text);
    wordBoundary.length = wordBoundary.text.length;
    return wordBoundary;
  }

  _createWordBoundaryError(message, errorEnum) {
    const error = ErrorHelper.createDefaultError(errorEnum);
    error.message = message;
    error.source = document.URL;
    return error;
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.WordBoundaryEventManager = WordBoundaryEventManager;
