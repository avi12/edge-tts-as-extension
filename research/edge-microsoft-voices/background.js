// Copyright (C) Microsoft Corporation. All rights reserved.

let audioViewModel = null;
let hasRefreshedVoiceList = false;
let listenersRegistered = false;

function speakListener(utterance, options, sendTtsEvent) {
  try {
    audioViewModel.speak(utterance, options, sendTtsEvent);
  } catch (error) {
    handleUncaughtErrorInAudioViewModel(error);
  }
  if (!hasRefreshedVoiceList) {
    hasRefreshedVoiceList = true;
    const voiceListSingleton = VoiceListSingleton.instance();
    voiceListSingleton.refreshVoiceList(voiceListUpdated);
  }
}

function stopListener() {
  try {
    audioViewModel.stop();
  } catch (error) {
    handleUncaughtErrorInAudioViewModel(error);
  }
}

function pauseListener() {
  try {
    audioViewModel.pause();
  } catch (error) {
    handleUncaughtErrorInAudioViewModel(error);
  }
}

function resumeListener() {
  try {
    audioViewModel.resume();
  }  catch (error) {
    handleUncaughtErrorInAudioViewModel(error);
  }
}

function handleUncaughtErrorInAudioViewModel(error) {
  const errorObj = ErrorHelper.createDefaultError(
      TelemetryHelper.ErrorEnum().UNCAUGHT);
  errorObj.message = JSON.stringify(error);
  errorObj.source = document.URL;
  errorObj.errorEnum = TelemetryHelper.ErrorEnum().UNCAUGHT;
  audioViewModel.handleError(
      errorObj, ErrorHelper.SYNTHESIS_FAILED_ERROR_CODE());
}

function initializeVoiceList() {
  const voiceListSingleton = VoiceListSingleton.instance();
  voiceListSingleton.initializeVoiceList();
}

function voiceListUpdated() {
  const voiceListSingleton = VoiceListSingleton.instance();
  if (voiceListSingleton.voiceList.length > 0) {
    const voiceList = voiceListSingleton.getTtsVoiceList();
    chrome.ttsEngine.updateVoices(voiceList);
  }
}

function handleUncaughtErrorinVoiceList(
    message, source, lineNumber, columnNumber, error) {
  const errorString =
      message + ' ' + source + ':' + lineNumber + ':' + columnNumber;
  error.line = lineNumber;
  error.column = columnNumber;
  error.stack = errorString;
  error.errorEnum =
      error.errorEnum ?
          error.errorEnum : TelemetryHelper.ErrorEnum().VOICE_LIST;
  ErrorHelper.logError(error);
}

function initializeMicrosoftVoices(
    viewModel = new AudioViewModel(), voiceListRefreshCompleted = false) {
  audioViewModel = viewModel;
  hasRefreshedVoiceList = voiceListRefreshCompleted;
  if (!listenersRegistered) {
    chrome.ttsEngine.onSpeak.addListener(speakListener);
    chrome.ttsEngine.onStop.addListener(stopListener);
    chrome.ttsEngine.onPause.addListener(pauseListener);
    chrome.ttsEngine.onResume.addListener(resumeListener);
    listenersRegistered = true;
  }
  window.onerror = handleUncaughtErrorinVoiceList.bind(this);
  window.onload = initializeVoiceList;
}

initializeMicrosoftVoices();

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.background = {
  initialize: initializeMicrosoftVoices,
  initializeVoiceList,
  speakListener,
  stopListener,
  pauseListener,
  resumeListener,
  voiceListUpdated,
};
