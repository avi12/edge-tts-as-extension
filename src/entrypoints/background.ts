import { DEFAULT_PROSODY, EDGE_EXTENSION_ORIGIN, EDGE_USER_AGENT, SERVICE_HOST } from "@/lib/edge-tts";
import {
  Command,
  IDLE_STATE,
  OFFSCREEN_TARGET,
  type PlayerRequest,
  type PlayerState,
  playerTargetSchema,
  type Request,
  requestSchema,
  type SpeakRequest,
  type StateEvent,
  stateEventSchema
} from "@/lib/messages";
import { settings } from "@/lib/settings";
import { KeyboardCommand } from "@/lib/shortcuts";

enum MenuItemId {
  ReadAloud = "read-aloud",
  StopReading = "stop-reading"
}

enum HeaderName {
  Origin = "Origin",
  UserAgent = "User-Agent"
}

const OFFSCREEN_PATH = "/offscreen.html";
const HEADER_RULE_ID = 1;
const HEADER_RULE_PRIORITY = 1;

interface RequesterFrame {
  tabId: number;
  frameId: number;
}

let offscreenCreation: Promise<void> | null = null;
let speakerFrame: RequesterFrame | null = null;

// The service only accepts handshakes that carry Edge's extension Origin and an Edge User-Agent -
// rewrite both, but only for this extension's requests
async function installHeaderRule() {
  const { HeaderOperation, ResourceType, RuleActionType } = browser.declarativeNetRequest;
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [HEADER_RULE_ID],
    addRules: [
      {
        id: HEADER_RULE_ID,
        priority: HEADER_RULE_PRIORITY,
        action: {
          type: RuleActionType.MODIFY_HEADERS,
          requestHeaders: [
            {
              header: HeaderName.Origin,
              operation: HeaderOperation.SET,
              value: EDGE_EXTENSION_ORIGIN
            },
            {
              header: HeaderName.UserAgent,
              operation: HeaderOperation.SET,
              value: EDGE_USER_AGENT
            }
          ]
        },
        condition: {
          requestDomains: [SERVICE_HOST],
          initiatorDomains: [browser.runtime.id],
          resourceTypes: [ResourceType.WEBSOCKET, ResourceType.XMLHTTPREQUEST]
        }
      }
    ]
  });
}

async function sendToPlayer(request: PlayerRequest) {
  const state: PlayerState = await browser.runtime.sendMessage({
    ...request,
    target: OFFSCREEN_TARGET
  });
  return state;
}

async function hasOffscreen() {
  const contexts = await browser.runtime.getContexts({
    contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) {
    return;
  }

  // AUDIO_PLAYBACK alone gets the document closed after 30 s of silence, which would kill a paused
  // reading. BLOBS is also true: the audio is streamed through a MediaSource object URL
  offscreenCreation ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [browser.offscreen.Reason.AUDIO_PLAYBACK, browser.offscreen.Reason.BLOBS],
      justification: "Streams synthesized speech into an audio element"
    })
    .finally(() => {
      offscreenCreation = null;
    });
  await offscreenCreation;
}

async function speak({ request, frame }: {
  request: SpeakRequest;
  frame?: RequesterFrame;
}) {
  speakerFrame = frame ?? null;
  const text = request.text.trim();
  if (!text) {
    return IDLE_STATE;
  }

  const savedSettings = await settings.getValue();
  await ensureOffscreen();
  return sendToPlayer({
    type: Command.Speak,
    text,
    voice: request.voice ?? savedSettings.voice,
    prosody: {
      ...DEFAULT_PROSODY,
      rate: request.rate ?? savedSettings.rate
    }
  });
}

async function handle({ request, frame }: {
  request: Request;
  frame?: RequesterFrame;
}) {
  if (request.type === Command.Speak) {
    return speak({
      request,
      frame
    });
  }

  const isPlayerOpen = await hasOffscreen();
  if (!isPlayerOpen) {
    return IDLE_STATE;
  }

  return sendToPlayer(request);
}

function getRequesterFrame(sender: Browser.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  const { frameId } = sender;
  const isFromTab = tabId !== undefined && frameId !== undefined;
  return isFromTab
    ? {
      tabId,
      frameId
    }
    : undefined;
}

function ignoreClosedFrame() {}

function forwardToSpeakerFrame(event: StateEvent) {
  if (!speakerFrame) {
    return;
  }

  browser.tabs.sendMessage(speakerFrame.tabId, event, { frameId: speakerFrame.frameId }).catch(ignoreClosedFrame);
}

function respondToRequest({ message, frame, sendResponse }: {
  message: unknown;
  frame?: RequesterFrame;
  sendResponse: (state: PlayerState) => void;
}) {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) {
    return false;
  }

  void handle({
    request: parsed.data,
    frame
  }).then(sendResponse);
  return true;
}

export default defineBackground(() => {
  void installHeaderRule();

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MenuItemId.ReadAloud,
      title: "Read aloud",
      contexts: [browser.contextMenus.ContextType.SELECTION]
    });
    browser.contextMenus.create({
      id: MenuItemId.StopReading,
      title: "Stop reading",
      contexts: [browser.contextMenus.ContextType.ALL]
    });
  });

  browser.contextMenus.onClicked.addListener(({ menuItemId, selectionText }) => {
    if (menuItemId === MenuItemId.StopReading) {
      void handle({
        request: {
          type: Command.Stop
        }
      });
      return;
    }

    const isReadAloud = menuItemId === MenuItemId.ReadAloud;
    if (!isReadAloud || !selectionText) {
      return;
    }

    void handle({
      request: {
        type: Command.Speak,
        text: selectionText
      }
    });
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    const tabId = tab?.id;
    const isReadSelection = command === KeyboardCommand.ReadSelection;
    if (!isReadSelection || tabId === undefined) {
      return;
    }

    const [injection] = await browser.scripting.executeScript({
      target: {
        tabId
      },
      func: () => getSelection()?.toString() ?? ""
    });
    const text = injection?.result;
    if (!text) {
      return;
    }

    await handle({
      request: {
        type: Command.Speak,
        text
      }
    });
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const isForPlayer = playerTargetSchema.safeParse(message).success;
    if (isForPlayer) {
      return false;
    }

    const parsedStateEvent = stateEventSchema.safeParse(message);
    if (parsedStateEvent.success) {
      forwardToSpeakerFrame(parsedStateEvent.data);
      return false;
    }

    return respondToRequest({
      message,
      frame: getRequesterFrame(sender),
      sendResponse
    });
  });

  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => respondToRequest({
    message,
    sendResponse
  }));
});
