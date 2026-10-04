// Copyright (C) Microsoft Corporation. All rights reserved.

const BASE_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize' +
    '/readaloud/voices/list';

const CETO_URL = 'https://api.msedgeservices.com/tts/cognitiveservices/voices/list';

class VoiceListRequester {

  static getVoiceList(onVoiceListAcquired) {
    chrome.edgeSpeechPrivate.shouldUseCetoServiceUrl(
      VoiceListRequester._getVoiceListWithCetoStatus.bind(
          this, onVoiceListAcquired));
  }

  static _getVoiceListWithCetoStatus(onVoiceListAcquired, cetoStatusResponse) {
    chrome.systemPrivate.getApiKey(
      VoiceListRequester._getVoiceListWithKey.bind(
          this, onVoiceListAcquired, cetoStatusResponse));
  }

  static _getVoiceListWithKey(onVoiceListAcquired, cetoStatus, key) {
    const urlBase = cetoStatus ? CETO_URL : BASE_URL;
    const urlBaseTemp = cetoStatus ? urlBase + '?Ocp-Apim-Subscription-Key=' : urlBase + '?trustedclienttoken=';
    const url = urlBaseTemp + key;
    const httpRequest = new XMLHttpRequest();
    httpRequest.onreadystatechange =
        VoiceListRequester._readyStateChanged.bind(
            this, httpRequest, onVoiceListAcquired, cetoStatus);
    httpRequest.onerror =
        VoiceListRequester._handleError.bind(this, httpRequest, cetoStatus);
    httpRequest.responseType = 'json';
    httpRequest.open('GET', encodeURI(url), true);
    httpRequest.send();
  }

  static _readyStateChanged(httpRequest, onVoiceListAcquired, cetoStatus) {
    if (VoiceListRequester._isRequestReady(httpRequest)) {
      VoiceListRequester._handleReadyRequest(httpRequest, onVoiceListAcquired, cetoStatus);
    }

    if (VoiceListRequester._isRequestError(httpRequest)) {
      VoiceListRequester._handleError(httpRequest);
    }
  }

  static _isRequestReady(httpRequest) {
    return ((httpRequest.readyState === 4) && (httpRequest.status === 200));
  }

  static _isRequestError(httpRequest) {
    return ((httpRequest.readyState === 4) && (httpRequest.status !== 200)
        && (httpRequest.status !== 0)); // 0 indicates no internet connection
  }

  static _isNoInternetError(httpRequest) {
    return (httpRequest.status === 0) && (httpRequest.responseURL === '');
  }

  static _handleReadyRequest(httpRequest, onVoiceListAcquired, cetoStatus) {
    const voiceList = httpRequest.response;
    if (!this._isVoiceListUsable(voiceList)) {
      const error = ErrorHelper.createDefaultError(
        TelemetryHelper.ErrorEnum().VOICE_LIST_RESPONSE);
      error.message =
          'status: ' + httpRequest.status + ' responseURL: '
          + httpRequest.responseURL + 'response type: ' +
          httpRequest.responseType + ' response: ' + voiceList;
      ErrorHelper.logError(error);
      return;
    }
    onVoiceListAcquired(voiceList, cetoStatus);
  }

  static _handleError(httpRequest) {
    // if the user is not connected to the internet when a call to the service
    // is made, the REST call will throw a specific error. This equates to noise
    // on our end, so ignore the error for telemetry and error reporting.
    if (this._isNoInternetError(httpRequest)) {
      return;
    }
    const error = ErrorHelper.createDefaultError(
        TelemetryHelper.ErrorEnum().VOICE_LIST_CONNECTION);
    error.message =
        'status: ' + httpRequest.status + ' responseURL: '
        + httpRequest.responseURL;
    ErrorHelper.logError(error);
  }

  static _isVoiceListUsable(voiceList) {
    return !((voiceList === undefined) || (voiceList === null) ||
        (voiceList.forEach === undefined) || (voiceList.forEach === null));
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.VoiceListRequester = VoiceListRequester;
