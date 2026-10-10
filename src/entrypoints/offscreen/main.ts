import { createPlayer } from "./player";
import { Command } from "@/lib/command";
import { type ControlCommand, SpeechMessage, speechMessenger } from "@/lib/messages";

function ignoreClosedPopup() {}

const player = createPlayer(async state => {
  await speechMessenger.sendMessage(SpeechMessage.PlayerState, state).catch(ignoreClosedPopup);
});

async function control(command: ControlCommand) {
  switch (command) {
    case Command.Pause:
      player.pause();
      return;
    case Command.Resume:
      await player.resume();
      return;
    case Command.Stop:
      player.stop();
      return;
    case Command.GetState:
  }
}

// Only the background sends here, and it has already validated what a page asked for
speechMessenger.onMessage(SpeechMessage.PlayerSpeak, ({ data }) => {
  // The reading outlives the message that starts it: the answer is the state it starts in, and the
  // rest of it follows through PlayerState
  void player.speak(data);
  return player.getState();
});

// The reading carries on under the new voice, so the answer is the state it carries on in
speechMessenger.onMessage(SpeechMessage.PlayerRespeak, ({ data }) => {
  // Same as a speak: the reading outlives the message, and the rest follows through PlayerState
  void player.respeak(data);
  return player.getState();
});

speechMessenger.onMessage(SpeechMessage.PlayerControl, async ({ data }) => {
  await control(data);
  return player.getState();
});
