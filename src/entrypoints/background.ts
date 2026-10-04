import { DEFAULT_PROSODY, EDGE_EXTENSION_ORIGIN, EDGE_USER_AGENT, SERVICE_HOST } from "@/lib/edge-tts";
import {
  Command,
  OFFSCREEN_TARGET,
  type PlayerRequest,
  playerTargetSchema,
  type Request,
  requestSchema,
  type SpeakRequest
} from "@/lib/messages";
import { IDLE_STATE, type PlayerState } from "@/lib/player-status";
import { settings } from "@/lib/settings";

enum HeaderName {
  Origin = "Origin",
  UserAgent = "User-Agent"
}

const OFFSCREEN_PATH = "/offscreen.html";
const HEADER_RULE_ID = 1;
const HEADER_RULE_PRIORITY = 1;

let offscreenCreation: Promise<void> | null = null;

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

async function speak(request: SpeakRequest) {
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

async function handle(request: Request) {
  if (request.type === Command.Speak) {
    return speak(request);
  }

  const isPlayerOpen = await hasOffscreen();
  if (!isPlayerOpen) {
    return IDLE_STATE;
  }

  return sendToPlayer(request);
}

function respondToRequest({ message, sendResponse }: {
  message: unknown;
  sendResponse: (state: PlayerState) => void;
}) {
  const parsed = requestSchema.safeParse(message);
  if (!parsed.success) {
    return false;
  }

  void handle(parsed.data).then(sendResponse);
  return true;
}

export default defineBackground(() => {
  void installHeaderRule();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const isForPlayer = playerTargetSchema.safeParse(message).success;
    if (isForPlayer) {
      return false;
    }

    return respondToRequest({
      message,
      sendResponse
    });
  });

  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => respondToRequest({
    message,
    sendResponse
  }));
});
