// Copyright (C) Microsoft Corporation. All rights reserved.

class Config {

  static createConfig() {
    const configObj = {};
    configObj.context = {};
    configObj.context.synthesis = {};
    configObj.context.synthesis.audio = {};
    configObj.context.synthesis.audio.metadataoptions = {};
    configObj.context.synthesis.audio.metadataoptions.sentenceBoundaryEnabled =
        'false';
    configObj.context.synthesis.audio.metadataoptions.wordBoundaryEnabled =
        'true';
    configObj.context.synthesis.audio.outputFormat =
        'webm-24khz-16bit-mono-opus';
    return JSON.stringify(configObj);
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.Config = Config;
