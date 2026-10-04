import {
  Command,
  OFFSCREEN_TARGET,
  STATE_EVENT,
  type PlayerRequest,
  type StateEvent,
} from '@/lib/messages';
import { Player } from './player';

const player = new Player((state) => {
  const event: StateEvent = { type: STATE_EVENT, state };
  // Nobody listening (popup closed) is fine.
  browser.runtime.sendMessage(event).catch(() => {});
});

browser.runtime.onMessage.addListener(
  (message: PlayerRequest & { target?: string }, _sender, sendResponse) => {
    if (message?.target !== OFFSCREEN_TARGET) return;
    switch (message.type) {
      case Command.Speak:
        player.speak(message.text, message.voice, message.prosody);
        break;
      case Command.Pause:
        player.pause();
        break;
      case Command.Resume:
        player.resume();
        break;
      case Command.Stop:
        player.stop();
        break;
    }
    sendResponse(player.getState());
  },
);
