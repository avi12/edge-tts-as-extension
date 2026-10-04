// Copyright (C) Microsoft Corporation. All rights reserved.

class ManifestHelper {

  static getVoiceAttribute(voiceName, attributeName, defaultValue = null) {
    const voices = ManifestHelper.getVoiceList();
    let result = defaultValue;
    let i;
    for (i = 0; i < voices.length; ++i) {
      if (voiceName === voices[i]['voice_name']) {
        result = voices[i][attributeName];
        break;
      }
    }

    return result;
  }

  static getVoiceList() {
    const manifestData = chrome.runtime.getManifest();
    return manifestData['tts_engine']['voices'];
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.ManifestHelper = ManifestHelper;
