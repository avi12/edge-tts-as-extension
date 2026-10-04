// Copyright (C) Microsoft Corporation. All rights reserved.

const WAKEUP_INTERVAL_MILLIS = 7000;

class LifetimeHelper {
  constructor() {
    this._timeout = null;
    this._canContinue = false;
    this._id = 0;
  }

  start() {
    this._reset();
    this._canContinue = true;
    this._timeout = setTimeout(
        this._continue.bind(this, this._id), WAKEUP_INTERVAL_MILLIS);
  }

  stop() {
    ++this._id;
    this._reset();
  }

  _continue(id) {
    if (this._canContinue && (id === this._id)) {
      // Send a message to force the browser to keep the extension alive.
      // Since we didn't make any listeners in this extension and the message
      // will stay within this extension, this amounts to a no-op.
      const obj = {'message': 'continue'};
      chrome.runtime.sendMessage(obj);
      this._timeout = setTimeout(
          this._continue.bind(this, id), WAKEUP_INTERVAL_MILLIS);
    }
  }

  _reset() {
    this._canContinue = false;
    if (this._timeout !== null) {
      clearTimeout(this._timeout);
    }
    this._timeout = null;
  }
}

globalThis.MicrosoftVoices = globalThis.MicrosoftVoices || {};
globalThis.MicrosoftVoices.LifetimeHelper = LifetimeHelper;
