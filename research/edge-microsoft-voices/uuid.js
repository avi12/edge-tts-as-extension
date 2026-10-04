// Copyright (C) Microsoft Corporation. All rights reserved.

const ARRAY_LENGTH = 16;
const MIN_HEX_LENGTH = 2;

class UUID {

  static createUUID() {
    const array = new Uint8Array(ARRAY_LENGTH);
    window.crypto.getRandomValues(array);

    let uuid = '';
    for (let i = 0; i < ARRAY_LENGTH; i++) {
      let hexString = array[i].toString(ARRAY_LENGTH);
      hexString = this._formatHexString(hexString);
      uuid += hexString;
    }
    return uuid;
  }

  static _formatHexString(hexString) {
    if (hexString.length < MIN_HEX_LENGTH) {
      hexString = '0' + hexString;
    }
    return hexString;
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.UUID = UUID;
