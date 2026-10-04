// Copyright (C) Microsoft Corporation. All rights reserved.

const MAX_UTTERANCE_LENGTH = 32768;

// In the case of a very long utterance, when the audio buffer is filled,
// this is how much audio we clear every time we refill the buffer.
const FULL_BUFFER_TIMEOUT_SECONDS = 60;
const FULL_BUFFER_TIMEOUT_MILLISECONDS = FULL_BUFFER_TIMEOUT_SECONDS * 1000;

let tabTitle = '';

class AudioViewModel {
  static _resetTabTitleForTesting() {
    tabTitle = '';
  }

  constructor() {
    this._audio = new Audio();
    this._wordBoundaryEventManager = new WordBoundaryEventManager(
      this._audio,
      this._handleWordBoundaryEvent.bind(this),
      this.handleError.bind(this),
      this);

    // AudioViewModel keeps two streamers _audioStreamer and
    // _preloadAudioStreamer. _preloadAudioStreamer is used to preload audio for
    // an utterance while _audioStreamer is speaking the current utterance.
    // If speak comes for a preloaded utterance, we swap the streamers so that
    // preloaded stream can be used to speak the utterance and audioStreamer can
    // be used for a subsequent preloading request.

    // The audio streamer is responsible for fetching audio from the service
    // and passing it to the audio element.
    this._audioStreamer = new AudioStreamer(
      this._setAudioSource.bind(this),
      this._wordBoundaryEventManager.addWordBoundaries.bind(
          this._wordBoundaryEventManager),
      this._startPlayback.bind(this),
      this.handleError.bind(this),
      this._handleBufferFull.bind(this));

    // Preload audio streamer used to preload audio for an utterance while
    // another utterance is being spoken. This is used to reduce the delay
    // between utterances.
    this._preloadAudioStreamer = new AudioStreamer(
      this._setAudioSource.bind(this),
      this._wordBoundaryEventManager.addWordBoundaries.bind(
        this._wordBoundaryEventManager),
      this._startPlayback.bind(this),
      this.handleError.bind(this),
      this._handleBufferFull.bind(this));

    this._telemetryHelper = new TelemetryHelper();
    this._lifetimeHelper = new LifetimeHelper();
    this._sendTtsEvent = null;
    this._utterance = null;
    this._voice = null;
    this._paused = false;
    this._needsFullReset = false;

    this._timeBufferEmptied = 0;
    this._fullBufferTimeout = 0;

    this._operationTimer = new TelemetryHelper();
  }

  speak(utterance, options, sendTtsEvent) {
    if (this._containsNullOrUndefined([utterance, options, sendTtsEvent])) {
      const error = ErrorHelper.createDefaultError(
          TelemetryHelper.ErrorEnum().INVALID_ARGUMENTS);
      error.message = JSON.stringify([sendTtsEvent]);
      error.source = document.URL;
      this.handleError(
          error, ErrorHelper.INVALID_ARGUMENT_ERROR_CODE());
      return;
    }

    // From tts_extension.js: Truncate the utterance if it's too long. Both
    // Chrome's tts extension api and the web speech api specify 32k as the
    // maximum limit for an utterance.
    if (utterance.length > MAX_UTTERANCE_LENGTH) {
      utterance = utterance.substr(0, MAX_UTTERANCE_LENGTH);
    }

    this._operationTimer.startTimer();
    utterance = Ssml.replaceNonstandardCharacters(utterance);
    this._operationTimer.recordOperationTime(
        TelemetryHelper.OperationsEnum().REPLACE_CHARACTERS);

    // the service requires that text sent in ssml is formatted a certain way.
    this._operationTimer.startTimer();
    const formattedUtterance = Ssml.formatRawText(utterance);
    this._operationTimer.recordOperationTime(
        TelemetryHelper.OperationsEnum().FORMAT_TEXT);

    if (options['enqueue']) {
      // If enqueue is true, we want to preload the audio for the utterance.
      // Start streaming the audio for the utterance, but don't start speaking
      // using prelodAudioStreamer.
      this._preloadAudioStreamer.reset();
      this._preloadAudioStreamer.startStream(formattedUtterance,
                                             options,
                                             sendTtsEvent);
    } else {
      this._operationTimer.startTimer();
      this._setMetadata(options['voiceName']);
      this._operationTimer.recordOperationTime(
          TelemetryHelper.OperationsEnum().SET_METADATA);

      this._operationTimer.startTimer();
      TelemetryHelper.recordAction(TelemetryHelper.ActionEnum().SPEAK);
      this._operationTimer.recordOperationTime(
          TelemetryHelper.OperationsEnum().RECORD_ACTION);
      this._operationTimer.startTimer();
      this._reset();
      this._operationTimer.recordOperationTime(
          TelemetryHelper.OperationsEnum().RESET);
      this._telemetryHelper.startTimer();
      this._sendTtsEvent = sendTtsEvent;
      this._voice = options.voiceName;
      this._utterance = utterance;
      this._wordBoundaryEventManager.setUtterance(this._utterance);

      // If the preloadAudioStreamer is for the same utterance, swap the
      // preloadAudioStreamer and audioStreamer. And start speaking using
      // already preloaded audio.
      if(this._preloadAudioStreamer.isStreamForUtterance(formattedUtterance,
                                                   options)){
        const tempStreamer = this._audioStreamer;
        this._audioStreamer = this._preloadAudioStreamer;
        this._preloadAudioStreamer = tempStreamer;
      } else {
        this._audioStreamer.startStream(formattedUtterance, options);
      }

      this._audioStreamer.startSpeak();
    }
  }

  stop() {
    this._telemetryHelper.recordTime(this._isNeuralVoice());
    this._needsFullReset = true;
    this._reset();
    tabTitle = '';
    if (this._sendTtsEvent != null) {
      TelemetryHelper.recordAction(TelemetryHelper.ActionEnum().CANCEL);
      this._sendTtsEvent({ 'type': 'end', 'charIndex': 0 });
    }
  }

  pause() {
    this._paused = true;
    this._audio.pause();
  }

  resume() {
    if (this._paused) {
      this._paused = false;
      this._audio.play();
    }
  }

  handleError(error, errorCode) {
    // isNoInternetError is ambiguous and should be tracked differently.
    if (error.isNoInternetError) {
      this._handleNoInternetError();
    } else if (!error.isNoInternetError) {
      TelemetryHelper.recordAction(TelemetryHelper.ActionEnum().ERROR);
      ErrorHelper.logError(error);
    }
    this._needsFullReset = true;
    this._reset();
    this._sendTtsEvent({ 'type' : 'error', 'errorMessage' : errorCode });
  }

  getUuid() {
    if (this._audioStreamer != null) {
      return this._audioStreamer.getUuid();
    }
    return null;
  }

  // isNoInternetError can indicate that the user is offline or that they are
  // failing to connect to the service for another reason (rate-limiting or
  // other blocking). Double-check that they are connected and record a
  // connection blocked error if so, otherwise, record no internet.
  _handleNoInternetError() {
    if (navigator.onLine) {
      TelemetryHelper.recordError(
          TelemetryHelper.ErrorEnum().CONNECTION_BLOCKED);
    } else {
      TelemetryHelper.recordError(TelemetryHelper.ErrorEnum().NO_INTERNET);
    }
  }

  _containsNullOrUndefined(args) {
    const nullOrUndefined = args.filter(function (arg) {
      return (arg === null) || (arg === undefined);
    });
    return (nullOrUndefined.length > 0);
  }

  _setAudioSource(mediaUrl) {
    this._audio.src = mediaUrl;
    this._audio.load();
  }

  _setMetadata(voiceName) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabTitle.length === 0) {
        // Some pages, like the edge:// pages, do not have a title property. So,
        // we fall back to a static string.
        tabTitle = (tabs[0] && tabs[0].title) ? tabs[0].title
                                              : 'Microsoft Edge';
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: tabTitle,
        artist: 'Text-to-Speech: ' + voiceName,
      });
    });
  }

  _startPlayback(emptyAudio = false) {
    this._audio.onended = this._utteranceFinished.bind(this, this._utterance);
    this._telemetryHelper.recordTime(this._isNeuralVoice());
    this._sendTtsEvent({ 'type': 'start', 'charIndex': 0 });

    // Recieving no audio (if all other parts of the protocol are followed)
    // is a valid response from the server, handle that case here.
    if (emptyAudio) {
      this._utteranceFinished(this._utterance);
    } else if (!this._paused) {
      this._audio.play().catch(() => {
        // Playing audio failed -- Handling this gracefully by skipping the
        // utterance and logging telemetry, else the extension will not proceed
        // further (i.e. it will not provide audio for upcoming utterances and
        // the feature using this extension will be stuck forever).
        this._utteranceFinished(this._utterance, /*isSuccessful = */ false);
        TelemetryHelper.recordAction(
          TelemetryHelper.ActionEnum().ERROR_PLAY_FAILED);
      });

      // Playing audio does not keep the extension alive, so we need a helper
      // to make sure that the browser does not kill our extension while
      // playing. (Occurs while reading very long words).
      this._lifetimeHelper.start();
    }
  }

  _utteranceFinished(utterance, isSuccessful = true) {
    if (isSuccessful) {
      TelemetryHelper.recordAction(TelemetryHelper.ActionEnum().FULL_LISTEN);
    }
    this._reset();
    this._sendTtsEvent({ 'type': 'end', 'charIndex': utterance.length });
  }

  _handleWordBoundaryEvent(startIndex, length) {
    this._sendTtsEvent(
        { 'type' : 'word', 'charIndex' : startIndex, 'length' : length });
  }

  _handleBufferFull(streamCallback) {
    const timeSinceLastEmpty =
        this._audio.currentTime - this._timeBufferEmptied;
    if (timeSinceLastEmpty >= FULL_BUFFER_TIMEOUT_SECONDS) {
      this._timeBufferEmptied = this._audio.currentTime;
      streamCallback(timeSinceLastEmpty);
    } else {
      this._fullBufferTimeout = setTimeout(
          this._handleBufferFull.bind(this, streamCallback),
          FULL_BUFFER_TIMEOUT_MILLISECONDS);
    }
  }

  _reset() {
    this._audio.pause();
    this._audio = new Audio();
    this._lifetimeHelper.stop();
    this._audioStreamer.reset(this._needsFullReset);
    this._wordBoundaryEventManager.reset(this._audio);
    this._telemetryHelper.resetTimer();
    this._paused = false;
    this._needsFullReset = false;

    this._timeBufferEmptied = 0;
    clearTimeout(this._fullBufferTimeout);
  }

  _isNeuralVoice() {
    return (this._voice != null) && (this._voice.indexOf('Neural') >= 0);
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.AudioViewModel = AudioViewModel;
