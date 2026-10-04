import { createPlayer } from "./player";
import { Command, playerMessageSchema, STATE_EVENT, type StateEvent } from "@/lib/messages";

function ignoreClosedPopup() {}

const player = createPlayer(state => {
  const event: StateEvent = {
    type: STATE_EVENT,
    state
  };
  browser.runtime.sendMessage(event).catch(ignoreClosedPopup);
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const parsed = playerMessageSchema.safeParse(message);
  if (!parsed.success) {
    return;
  }

  const request = parsed.data;
  switch (request.type) {
    case Command.Speak:
      void player.speak(request);
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
});
