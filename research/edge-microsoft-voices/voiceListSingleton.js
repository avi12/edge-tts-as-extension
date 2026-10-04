// Copyright (C) Microsoft Corporation. All rights reserved.

const CACHE_KEY = 'voiceList';

class VoiceListSingleton {
  static instance() {
    if (VoiceListSingleton.singleton) {
      return VoiceListSingleton.singleton;
    }

    VoiceListSingleton.singleton = new VoiceListSingleton();
    return VoiceListSingleton.singleton;
  }

  constructor() {
    this.voiceList = []; // List of type VoiceModel

    // When the voices are updated from the server, there is a chance that an
    // utterance for a deprecated voice has been queued. This backup list
    // contains the deprecated list, so that those requests can be completed,
    // and a smooth transition to the new list can be made.
    this._backupVoiceList = [];

    this._OnVoiceListUpdated = null;
  }

  // Get the voices from the manifest by default, then check the cache.
  initializeVoiceList() {
    this.voiceList = VoiceModel.createFromManifestVoiceList(
        ManifestHelper.getVoiceList());
    chrome.storage.local.get(
        CACHE_KEY, this._voiceListAcquiredFromCache.bind(this));
  }

  // Reach out to the service to update the cache (and voice list).
  refreshVoiceList(onVoiceListUpdated) {
    this._OnVoiceListUpdated = onVoiceListUpdated;
    VoiceListRequester.getVoiceList(
        this._voiceListAcquiredFromService.bind(this));
  }

  getTtsVoiceList() {
    const ttsVoiceList = [];
    this.voiceList.forEach((voiceModel) => {
      ttsVoiceList.push(voiceModel.toTtsVoice());
    });
    return ttsVoiceList;
  }

  containsVoice(friendlyName) {
    const voice = this.getName(friendlyName);
    return (voice !== null);
  }

  getOutputFormat(friendlyName) {
    return this._getField('friendlyName', friendlyName, 'outputFormat');
  }

  getName(friendlyName) {
    return this._getField('friendlyName', friendlyName, 'name');
  }

  _getField(inputField, inputValue, outputField) {
    let outputValue = this._getFieldFromList(this.voiceList, inputField,
        inputValue, outputField);
    // Check the backup list if the field is not found.
    if (outputValue === null && (this._backupVoiceList.length > 0)) {
      outputValue = this._getFieldFromList(this._backupVoiceList, inputField,
          inputValue, outputField);
    }
    return outputValue;
  }

  _getFieldFromList(list, inputField, inputValue, outputField) {
    let outputValue = null;
    list.forEach((voiceModel) => {
      if (voiceModel[inputField] === inputValue) {
        outputValue = voiceModel[outputField];
      }
    });
    return outputValue;
  }

  _voiceListAcquiredFromService(voiceList, cetoStatus) {
    const serviceVoiceList =
        VoiceModel.createFromServiceVoiceList(voiceList, cetoStatus);
    if (serviceVoiceList.length === 0) {
      const error = ErrorHelper.createDefaultError(
          TelemetryHelper.ErrorEnum().NO_USABLE_VOICES);
      error.message = 'The service returned an empty or malformed voice list.';
      ErrorHelper.logError(error);
      return;
    }

    this._backupVoiceList = this.voiceList;
    this.voiceList = serviceVoiceList;
    const voiceListObj = {};
    voiceListObj[CACHE_KEY] = this.voiceList;
    chrome.storage.local.set(voiceListObj, this._voiceListCached.bind(this));
    this._OnVoiceListUpdated();
  }

  _voiceListAcquiredFromCache(voiceListObj) {
    // If there was an error, record it. Otherwise, update the voice list with
    // the contents of the cache.
    if (chrome.runtime.lastError !== undefined) {
      this._handleCacheError(
          'retrieving', chrome.runtime.lastError.message);
      return;
    }
    const cacheVoiceList = voiceListObj[CACHE_KEY];
    if ((cacheVoiceList !== undefined) && (cacheVoiceList !== null) &&
        (cacheVoiceList.length > 0)) {
      this.voiceList = cacheVoiceList;
    }
  }

  _voiceListCached() {
    if (chrome.runtime.lastError !== undefined) {
      this._handleCacheError(
          'caching', chrome.runtime.lastError.message);
    }
  }

  _handleCacheError(customMessage, runtimeMessage) {
    const error = ErrorHelper.createDefaultError(
        TelemetryHelper.ErrorEnum().VOICE_LIST_CACHE);
    error.message = customMessage + ':' + runtimeMessage;
    ErrorHelper.logError(error);
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.VoiceListSingleton = VoiceListSingleton;
