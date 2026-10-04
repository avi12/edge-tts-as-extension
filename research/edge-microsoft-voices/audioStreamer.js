// Copyright (C) Microsoft Corporation. All rights reserved.

const SERVER_URL =
    'wss://speech.platform.bing.com/consumer/speech/synthesize' +
    '/readaloud/edge/v1';
const CETO_SERVER_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1';
const OPUS_CODEC = 'audio/webm; codecs=opus';
const NORMAL_CLOSURE = 1000;
const ABNORMAL_CLOSURE = 1006;
const HEADER_LENGTH_BYTES = 2;
const MEDIA_DURATION_PLACEHOLDER_SECONDS = 60 * 30;
const MAX_RETRY_ATTEMPTS = 1;
const RETRY_WAIT_TIME_MILLISECONDS = 200;
const TIMEOUT_MILLISECONDS = 5000;

// Class that handles connecting to the speech service. Downloads Audio and
// Word Boundary Events with one Websocket connection. Audio is received as
// binary chunks and Word Boundary Events are recieved as JSON text.
class AudioStreamer {
  constructor(
      onSourceReady, onWordBoundariesReceived, onPlaybackReady, onError,
    onBufferFull) {
    this._initializeState();

    this._serverUrl = null;
    this._onWordBoundariesReceived = onWordBoundariesReceived;
    this._onPlaybackReady = onPlaybackReady;
    this._onError = onError;
    this._onSourceReady = onSourceReady;
    this._onBufferFull = onBufferFull;
    this._useCetoUrl = false;
    this._isCetoStatusInitialized = false;
    // Identifies the current stream so asynchronous URL initialization cannot
    // resume a stream that reset() has cancelled.
    this._streamId = 0;

    this._timer = new TelemetryHelper();
    this._networkErrorTimer = new TelemetryHelper();
    this._loadBinaryId = 0;
    this._messageId = 0;

    // The current utterance and options being streamed.
    this._currentUtterance = null;
    this._currentUtteranceOptions = null;

    // In case of preload, the utterance gets streamed but we may not have
    // started speaking yet - _pendingWordBoundaries stores word boundaries
    // until we start speaking.
    this._pendingWordBoundaries = [];
  }

  // Returns true if the current stream is for the utterance and the options
  // passed in. This can be used for checking if a stream is already created
  // for a particular utterance and options - eg: preload scenario.
  isStreamForUtterance(utterance, options) {
    if (
      this._currentUtterance === null ||
      this._currentUtteranceOptions === null
    ) {
      return false;
    }
    return (
      this._currentUtterance === utterance &&
      this._currentUtteranceOptions.voiceName === options.voiceName &&
      this._currentUtteranceOptions.rate === options.rate
    );
  }

  startStream(utterance, options, retryArgs = new RetryArgs()) {
    this._isActive = true;
    this._currentUtterance = utterance;
    this._currentUtteranceOptions = options;
    this._initializeFromRetryArgs(retryArgs);

    if (!this._isCetoStatusInitialized) {
      const streamId = this._streamId;
      const startStreamFunction =
          this.startStream.bind(this, utterance, options, retryArgs);
      const cetoFunction = this._initializeCeto.bind(
          this, startStreamFunction, streamId);
      chrome.edgeSpeechPrivate.shouldUseCetoServiceUrl(cetoFunction);
      return;
    }

    // The connection is already open, skip opening a new connection.
    if (this._isConnectionOpen) {
      this._bindConnectionHandlers(utterance, options, retryArgs);
      this._connectionOpened(utterance, options);
      return;
    }

    if (this._serverUrl === null) {
      const streamId = this._streamId;
      const startStreamFunction =
          this.startStream.bind(this, utterance, options, retryArgs);
      chrome.systemPrivate.getApiKey(this._initializeUrl.bind(
          this, startStreamFunction, streamId));
      return;
    }

    // If there is an issue connecting to the service, an error will be thrown
    // here
    try {
      const serverUrl = this._serverUrl;
      this._serverUrl = null;
      // Set a timeout for connecting, since WebSocket does not provide this.
      this._connectionTimeoutHandle = setTimeout(
          this._handleConnectionTimeout.bind(
              this, utterance, options, retryArgs), TIMEOUT_MILLISECONDS);
      this._timer.startTimer();
      this._connection = new WebSocket(
          serverUrl + this._getConnectionIdString());
      this._timer.recordOperationTime(
          TelemetryHelper.OperationsEnum().CREATE_CONNECTION);
    } catch(error) {
      const errorObj =
          ErrorHelper.createDefaultError(
              TelemetryHelper.ErrorEnum().CONNECTION_OPEN);
      errorObj.message = JSON.stringify(error);
      errorObj.source = document.URL;
      this._onError(
          errorObj,
          ErrorHelper.NETWORK_ERROR_CODE());
      return;
    }

    this._timer.startTimer();
    this._bindConnectionHandlers(utterance, options, retryArgs);
  }

  // Speaking can start only if streaming has already started.
  // StartStreaming should be called before this.
  startSpeak(retryArgs = new RetryArgs()) {
    if (this._isActive) {
      this._initializeMediaSource(retryArgs);
    }
  }

  reset(shouldClearConnection = true, isRetry = false) {
    // Invalidate any in-flight asynchronous URL-initialization callbacks.
    ++this._streamId;
    this._clearEventHandlers(shouldClearConnection, isRetry);
    // If the connection is non-null and open, close it, ensuring the proper
    // handshake is completed.
    if ((this._connection != null) && (this._connection.readyState === 1) &&
        shouldClearConnection) {
      this._connection.close(NORMAL_CLOSURE);
    }
    if (shouldClearConnection) {
      this._serverUrl = null;
    }

    if (!isRetry && (this._mediaSource != null) &&
        (this._mediaSource.sourceBuffers.length > 0)) {
      this._mediaSource.removeSourceBuffer(this._sourceBuffer);
    }

    this._initializeState(shouldClearConnection, isRetry);
  }

  getUuid() {
    return this._uuid;
  }

  _getConnectionIdString() {
    this._connectionId = UUID.createUUID();
    return '&ConnectionId=' + this._connectionId;
  }

  _bindConnectionHandlers(utterance, options, retryArgs) {
    this._connection.onopen =
        this._connectionOpened.bind(this, utterance, options);
    this._connection.onerror =
        this._handleConnectionError.bind(
            this, utterance, options, retryArgs);
    this._connection.onclose = this._handleConnectionClosed.bind(
        this, utterance, options, retryArgs);
    this._connection.onmessage = this._handleMessage.bind(this);
  }

  _clearEventHandlers(shouldClearConnection = true, isRetry = false) {
    this._conditionallyClearTimeout(this._retryTimeoutHandle);
    this._conditionallyClearTimeout(this._connectionTimeoutHandle);
    if (this._connection && shouldClearConnection) {
      this._connection.onopen = null;
      this._connection.onmessage = null;
      this._connection.onclose = null;
      this._connection.onerror = null;
    }
    if (!isRetry && this._mediaSource) {
      this._mediaSource.onsourceopen = null;
    }
    if (!isRetry && this._sourceBuffer) {
      this._sourceBuffer.onupdate = null;
      this._sourceBuffer.onupdateend = null;
      this._sourceBuffer.onupdatestart = null;
    }
  }

  _conditionallyClearTimeout(timeoutHandle) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  _initializeState(initializeConnection = true, isRetry = false) {
    if (initializeConnection) {
      this._connection = null;
      this._isConnectionOpen = false;
    }
    if (!isRetry) {
      this._mediaSource = null;
      this._sourceBuffer = null;
      this._sourceOpened = false;
      this._appendingToBuffer = false;
      this._receivedAudio = false;
      this._isPlaybackStarted = false;
      this._audioBuffer = [];
      this._currentUtterance = null;
      this._currentUtteranceOptions = null;
      this._pendingWordBoundaries = [];
    }
    this._isActive = false;
    this._downloadStarted = false;
    this._downloadEnded = false;
    this._loadingBinaryCount = 0;
    this._uuid = null;
    this._connectionId = null;
    this._loadBinaryId = 0;
    this._messageId = 0;
    this._currentChunkCount = 0;
    this._receivedChunkCount = 0;
    this._currentBoundaryCount = 0;
    this._previousChunkCount = 0;
    this._previousBoundaryCount = 0;
    this._retryTimeoutHandle = 0;
    this._connectionTimeoutHandle = 0;
  }

  _initializeUrl(callback, streamId, key) {
    if (streamId !== this._streamId) {
      return;
    }

    if (this._useCetoUrl) {
      this._serverUrl = CETO_SERVER_URL + '?Ocp-Apim-Subscription-Key=' + key;
    } else {
      this._serverUrl = SERVER_URL + '?TrustedClientToken=' + key;
    }
    callback();
  }

  _initializeCeto(callback, streamId, cetoStatusResponse) {
    if (streamId !== this._streamId) {
      return;
    }

    this._useCetoUrl = cetoStatusResponse;
    this._isCetoStatusInitialized = true;
    callback();
  }

  _connectionOpened(utterance, options) {
    this._conditionallyClearTimeout(this._connectionTimeoutHandle);
    this._isConnectionOpen = true;
    this._timer.recordOperationTime(
        TelemetryHelper.OperationsEnum().OPEN_CONNECTION);
    this._timer.startTimer();
    const configMessage = this._createConfigMessage();
    this._timer.recordOperationTime(
        TelemetryHelper.OperationsEnum().CREATE_CONFIG);
    this._timer.startTimer();
    this._connection.send(configMessage);
    this._timer.recordOperationTime(
        TelemetryHelper.OperationsEnum().SEND_CONFIG);

    //send ssml message
    this._timer.startTimer();
    const ssmlMessage = this._createSsmlMessage(utterance, options);
    this._timer.recordOperationTime(
        TelemetryHelper.OperationsEnum().CREATE_SSML);
    this._timer.startTimer();
    this._connection.send(ssmlMessage);
  }

  _createSsmlMessage(utterance, options) {
    const ssml = Ssml.createSsml(utterance, options);
    const currentTime = new Date();
    this._uuid = UUID.createUUID();
    const ssmlMessage = 'X-RequestId:' + this._uuid +
        '\r\nContent-Type:application\/ssml+xml\r\nX-Timestamp:'
        + currentTime.toString() + 'Z\r\nPath:ssml\r\n\r\n' + ssml;
    return ssmlMessage;
  }

  _createConfigMessage() {
    const currentTime = new Date();
    const config = Config.createConfig();
    const configMessage = 'X-Timestamp:' + currentTime.toString() +
      '\r\nContent-Type:application/json; ' +
      'charset=utf-8\r\nPath:speech.config\r\n\r\n' +
      config;
    return configMessage;
  }

  _handleMessage(messageEvent) {
    // Note: A console.log() can be used here to log messageEvent.data

    if(messageEvent.data instanceof Blob) {
      if (this._messageId === 0) {
        this._timer.recordOperationTime(
            TelemetryHelper.OperationsEnum().RECEIVE_MESSAGE);
        ++this._messageId;
      }
      this._handleBinaryMessage(messageEvent.data);
    }

    if(typeof(messageEvent.data) === 'string') {
      this._handleStringMessage(messageEvent.data);
    }
  }

  _handleBinaryMessage(data) {
    // Skip this chunk if we have already processed it in a previous stream
    // attempt.
    this._receivedChunkCount += 1;
    if (this._receivedChunkCount <= this._previousChunkCount) {
      return;
    }
    this._loadingBinaryCount += 1;
    const temporaryFileReader = new FileReader();
    if (this._loadBinaryId === 0) {
      this._timer.startTimer();
    }
    temporaryFileReader.onload =
      this._handleBinaryLoaded.bind(this, this._uuid, this._loadBinaryId);
    ++this._loadBinaryId;
    temporaryFileReader.readAsArrayBuffer(data);
  }

  _handleBinaryLoaded(uuid, binaryId, e) {
    // Loading a binary is an asynchronous operation, this makes sure that
    // the loaded binary is fresh
    if (this._uuid !== uuid) {
      return;
    }

    if (binaryId === 0) {
      this._timer.recordOperationTime(
          TelemetryHelper.OperationsEnum().BINARY_LOAD);
      this._timer.startTimer();
    }

    const buffer = e.target.result;
    const dataview = new DataView(buffer);
    const headerLength = dataview.getInt16(0);
    const body = buffer.slice(HEADER_LENGTH_BYTES + headerLength);
    if (binaryId === 0) {
      this._timer.recordOperationTime(
          TelemetryHelper.OperationsEnum().SLICE_BUFFER);
    }

    if (body.byteLength > 0) {
      this._receivedAudio = true;
      if (binaryId === 0) {
        this._timer.startTimer();
      }
      this._audioBuffer.push(body);
      this._currentChunkCount += 1;
      if (binaryId === 0) {
        this._timer.recordOperationTime(
            TelemetryHelper.OperationsEnum().PUSH_BUFFER);
      }
    }
    this._loadingBinaryCount -= 1;
    if (this._sourceBuffer != null) {
      this._handleSourceBufferUpdate();
    }
  }


  _handleStringMessage(data) {
    if (data.indexOf('turn.start') >= 0) {
      this._downloadStarted = true;
    }

    if (data.indexOf('turn.end') >= 0) {
      this._handleStreamEnd();
    }

    if (data.indexOf('audio.metadata') >= 0) {
      this._handleMetadata(data);
    }
  }

  _handleStreamEnd() {
    this._downloadEnded = true;
    this._handleSourceBufferUpdateEnd();
  }

  _handleMetadata(data) {
    const currentBoundaryCountTemp = this._currentBoundaryCount;
    const wordBoundaries = WordBoundary.getWordBoundaries(data);
    this._currentBoundaryCount += wordBoundaries.length;
    if ((currentBoundaryCountTemp < this._previousBoundaryCount) &&
        (this._currentBoundaryCount > this._previousBoundaryCount)) {
      const numberOfBoundariesToRemove =
          wordBoundaries.length -
          (this._currentBoundaryCount - this._previousBoundaryCount);
      wordBoundaries.splice(0, numberOfBoundariesToRemove);
    }
    if (this._currentBoundaryCount > this._previousBoundaryCount) {
      // In case speaking has not yet started (streaming happening for
      // preloading), then save the word boundaries until speaking starts.
      if (this._mediaSource != null) {
        this._onWordBoundariesReceived(wordBoundaries);
      } else {
        this._pendingWordBoundaries.push(wordBoundaries);
      }
    }
  }

  _handleSourceOpen(_) {
    this._sourceOpened = true;
    this._mediaSource.duration = MEDIA_DURATION_PLACEHOLDER_SECONDS;
    this._sourceBuffer = this._mediaSource.addSourceBuffer(OPUS_CODEC);
    this._sourceBuffer.onupdate = this._handleSourceBufferUpdate.bind(this);
    this._sourceBuffer.onupdateend =
      this._handleSourceBufferUpdateEnd.bind(this);
    this._sourceBuffer.onupdatestart =
      this._handleSourceBufferUpdateStart.bind(this);
    this._handleSourceBufferUpdate();
  }

  _handleSourceBufferUpdate() {
    if ((this._audioBuffer.length > 0) && this._sourceBufferAvailable()) {
      this._appendingToBuffer = true;
      const binary = this._audioBuffer.shift();
      try {
        this._sourceBuffer.appendBuffer(binary);
      } catch (error) {
        this._audioBuffer.unshift(binary);
        // Note: A console.log() can be used here to indicate buffer is full
        // and addition of binaries is paused until space is made.
        this._onBufferFull(this._handleSourceBufferCanEmpty.bind(this));
        return;
      }
      this._notifyPlayback();
    } else if (this._canEndStream()) {
      this._handleSourceBufferUpdateEnd();
    }
  }

  _handleSourceBufferUpdateEnd() {
    if (this._canEndStream() && this._sourceBufferAvailable()) {
      this._mediaSource.endOfStream();
      this._notifyPlayback();
    }
  }

  _handleSourceBufferUpdateStart() {
    this._appendingToBuffer = false;
  }

  _sourceBufferAvailable() {
    return ((this._sourceBuffer != null) && !this._sourceBuffer.updating);
  }

  _handleSourceBufferCanEmpty(durationToRemove) {
    if (this._sourceBufferAvailable()) {
      this._sourceBuffer.remove(0, durationToRemove);
    } else {
      this._onBufferFull(this._handleSourceBufferCanEmpty.bind(this));
    }
  }

  _canEndStream() {
    return (this._downloadEnded && (this._audioBuffer.length === 0) &&
        ((this._loadingBinaryCount === 0) && this._sourceOpened) &&
        !this._appendingToBuffer && (this._mediaSource.readyState === 'open'));
  }

  _notifyPlayback() {
    if (!this._isPlaybackStarted) {
      this._onPlaybackReady(!this._receivedAudio);
      this._isPlaybackStarted = true;
    }
  }

  _handleConnectionError(utterance, options, retryArgs, event) {
    const connectionError =
        this._createConnectionError(
            event, TelemetryHelper.ErrorEnum().CONNECTION_ERROR);
        this._retryOrBubbleError(
            connectionError, utterance, options, retryArgs);
  }

  _handleConnectionClosed(utterance, options, retryArgs, event) {
    this._isConnectionOpen = false;
    if ((event.code !== NORMAL_CLOSURE) && (event.code !== ABNORMAL_CLOSURE)) {
      const connectionError =
          this._createConnectionError(
              event, TelemetryHelper.ErrorEnum().CONNECTION_CLOSE);
      this._retryOrBubbleError(
          connectionError, utterance, options, retryArgs);
    } else if (this._downloadEnded) {
      // There was no error and the download has ended, so do nothing
      return;
    } else if (this._isActive) {
      // A normal closure in the middle of a download indicates a timeout from
      // the service, no error, retry the stream.
      this._retryStream(utterance, options, retryArgs);
    } else {
      this.reset();
    }
  }

  _createConnectionError(event, errorEnum) {
    const error = ErrorHelper.createDefaultError(errorEnum);
    error.message = JSON.stringify(event) + ' | requestID ' + this._uuid +
        ' | connectionID ' + this._connectionId;
    // If we recieve an error before the uuid has been set, then the user does
    // not have an internet connection.
    error.isNoInternetError = (this._uuid == null);
    return error;
  }

  _retryOrBubbleError(error, utterance, options, retryArgs) {
    if ((retryArgs.attemptCount < MAX_RETRY_ATTEMPTS)) {
      this._retryStream(utterance, options, retryArgs);
    } else {
      this._networkErrorTimer.recordOperationTime(
          TelemetryHelper.OperationsEnum().NETWORK_FAILURE);
      this._onError(error, ErrorHelper.NETWORK_ERROR_CODE());
    }
  }

  _retryStream(utterance, options, retryArgs) {
    retryArgs.chunkCount = this._currentChunkCount;
    retryArgs.boundaryCount = this._currentBoundaryCount;
    this.reset(true, true);
    ++retryArgs.attemptCount;
    this._retryTimeoutHandle = setTimeout(
      this.startStream.bind(this, utterance, options, retryArgs),
        RETRY_WAIT_TIME_MILLISECONDS);
  }

  _initializeFromRetryArgs(retryArgs) {
    if (retryArgs.attemptCount > 0) {
      this._previousChunkCount = retryArgs.chunkCount;
      this._previousBoundaryCount = retryArgs.boundaryCount;
    } else {
      // Telemetry to see how long Read Aloud waits until getting an error.
      this._networkErrorTimer.startTimer();
    }
  }

  _initializeMediaSource(retryArgs) {
    if (retryArgs.attemptCount === 0) {
      this._mediaSource = new MediaSource();
      const mediaUrl = URL.createObjectURL(this._mediaSource);
      this._timer.startTimer();
      this._onSourceReady(mediaUrl);
      this._timer.recordOperationTime(
          TelemetryHelper.OperationsEnum().SOURCE_READY);
      this._mediaSource.onsourceopen = this._handleSourceOpen.bind(this);

      // In case there are pending word boundaries, send them now that speaking
      // has started.
      for (const wordBoundaries of this._pendingWordBoundaries) {
        this._onWordBoundariesReceived(wordBoundaries);
      }
      this._pendingWordBoundaries = [];
    }
  }

  _handleConnectionTimeout(utterance, options, retryArgs) {
    const connectionError =
        this._createConnectionError(
            {}, TelemetryHelper.ErrorEnum().CONNECTION_TIMEOUT);
        this._retryOrBubbleError(
            connectionError, utterance, options, retryArgs);
  }
}

class RetryArgs {
  constructor() {
    this.attemptCount = 0;
    this.chunkCount = 0;
    this.boundaryCount = 0;
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.AudioStreamer = AudioStreamer;
globalThis.MicrosoftVoices.RetryArgs = RetryArgs;
