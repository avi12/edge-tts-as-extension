// Copyright (C) Microsoft Corporation. All rights reserved.

class VoiceModel {
  constructor(name, language, outputFormat, friendlyName) {
    this.name = name;
    this.language = language;
    this.outputFormat = outputFormat;
    this.friendlyName = friendlyName;
  }

  static createFromManifestVoice(manifestVoice) {
    return new VoiceModel(
      manifestVoice.server_name, manifestVoice.lang, manifestVoice.codec,
      manifestVoice.voice_name);
  }

  static createFromManifestVoiceList(manifestVoiceList) {
    const resultList = [];
    manifestVoiceList.forEach((manifestVoice) => {
      resultList.push(VoiceModel.createFromManifestVoice(manifestVoice));
    });
    return resultList;
  }

  static makeFriendlyNameFromCetoVoice(cetoVoice) {
    return 'Microsoft ' + cetoVoice.LocalName + ' Online (Natural) - ' +
        cetoVoice.LocaleName;
  }

  static createFromServiceVoice(serviceVoice, wasCetoVoice) {
    const friendlyName = wasCetoVoice ?
        this.makeFriendlyNameFromCetoVoice(serviceVoice) :
        serviceVoice.FriendlyName;
    return new VoiceModel(
        serviceVoice.Name, serviceVoice.Locale, serviceVoice.SuggestedCodec,
        friendlyName);
  }

  static isServiceVoiceListMalformed(serviceVoiceList, cetoStatus) {
    const requiredFields = ['Name', 'Locale', 'SuggestedCodec'];
    requiredFields.push(
        ...(cetoStatus ? ['LocalName', 'LocaleName'] : ['FriendlyName']));
    return serviceVoiceList.some((serviceVoice) =>
      serviceVoice === null || serviceVoice === undefined ||
          requiredFields.some((field) => serviceVoice[field] == null ||
              serviceVoice[field] === ''));
  }

  static createFromServiceVoiceList(serviceVoiceList, cetoStatus) {
    if (VoiceModel.isServiceVoiceListMalformed(
        serviceVoiceList, cetoStatus)) {
      return [];
    }

    const resultList = [];
    serviceVoiceList.forEach((serviceVoice) => {
      if (cetoStatus && (serviceVoice.Status !== 'GA' ||
          serviceVoice.VoiceType === 'NeuralHD')) {
        return; // Skip non-GA voices and HD voices when using Ceto service.
      }
      resultList.push(VoiceModel.createFromServiceVoice(serviceVoice,
          cetoStatus));
    });
    return resultList;
  }

  toTtsVoice() {
    return {
        eventTypes: ['end', 'error', 'start', 'word'],
        lang: this.language,
        remote: true,
        voiceName: this.friendlyName,
    };
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.VoiceModel = VoiceModel;
