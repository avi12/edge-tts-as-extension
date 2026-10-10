import { Command } from "@/lib/command";
import { EDGE_USER_AGENT, SYNTHESIZE_HOST } from "@/lib/edge-tts/constants";
import { detectLanguage, pickVoice } from "@/lib/edge-tts/language";
import { DEFAULT_PROSODY } from "@/lib/edge-tts/ssml";
import {
  type ControlCommand,
  controlCommandSchema,
  type SpeakRequest,
  speakRequestSchema
} from "@/lib/message-schemas";
import { SpeechMessage, speechMessenger } from "@/lib/messages";
import { IDLE_STATE, type SpeakingState } from "@/lib/player-status";
import { readSettings } from "@/lib/settings";
import { loadVoices } from "@/lib/voices";
import { z } from "@/lib/zod";

// The one header the gateway checks, spelled as HTTP defines it - the probe table in research/README.md
// has every combination that passes and fails
// https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/User-Agent
const USER_AGENT_HEADER = "User-Agent";

// Where WXT builds entrypoints/offscreen/index.html to: entrypoints/{name}/index.html -> /{name}.html
// https://wxt.dev/guide/essentials/entrypoints.html
const OFFSCREEN_PATH = "/offscreen.html";

// Ours, because this extension has exactly one session rule. The id is "mandatory and should be >= 1",
// and the priority only decides between rules that match the same request, where 1 is the documented
// default - so both are the smallest legal value rather than a ranking
// https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#type-Rule
// https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#priority-key
const HEADER_RULE_ID = 1;
const HEADER_RULE_PRIORITY = 1;

// Another extension asks in the shape the README documents, not in the messenger's envelope
const externalRequestSchema = z.discriminatedUnion("type", [
  speakRequestSchema.extend({ type: z.literal(Command.Speak) }),
  z.object({ type: controlCommandSchema })
]);

let offscreenCreation: Promise<void> | null = null;
// Only one reading plays at a time, so the player's state goes to the frame that asked for it last.
// It is re-learnt from every request, because a service worker that idles out forgets it: Chrome
// terminates one "after 30 seconds of inactivity", and "any global variables you set will be lost"
// https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-shutdown
let readingFrame: {
  tabId: number;
  frameId: number;
} | null = null;

// The service turns down handshakes whose User-Agent does not say Edge - rewrite it, but only on this
// extension's own requests to the synthesis host. Session rules are "cleared when the browser shuts
// down and when a new version of the extension is installed", which is why this reinstalls on startup;
// initiatorDomains narrows the rule to this extension's own origin and resourceTypes to the handshake
// https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#dynamic-and-session-rules
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
              header: USER_AGENT_HEADER,
              operation: HeaderOperation.SET,
              value: EDGE_USER_AGENT
            }
          ]
        },
        condition: {
          requestDomains: [SYNTHESIZE_HOST],
          initiatorDomains: [browser.runtime.id],
          resourceTypes: [ResourceType.WEBSOCKET]
        }
      }
    ]
  });
}

// getContexts is the documented way to ask whether the offscreen document is open, and
// OFFSCREEN_DOCUMENT is its ContextType for one
// https://developer.chrome.com/docs/extensions/reference/api/runtime#method-getContexts
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
  // reading - "the AUDIO_PLAYBACK reason sets the document to close after 30 seconds without audio
  // playing", and no other reason carries a timeout. BLOBS is also true: the audio is streamed through
  // a MediaSource object URL. The justification is required, and its wording is ours
  // https://developer.chrome.com/docs/extensions/reference/api/offscreen#type-Reason
  // https://developer.chrome.com/docs/extensions/reference/api/offscreen#property-CreateParameters-justification
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

// Without the voice list there is nothing to switch to, so the picked voice reads
async function chooseVoice({ text, voice, isMatchingLanguage, locale }: {
  text: string;
  voice: string;
  isMatchingLanguage: boolean;
  locale: string | undefined;
}) {
  const language = (isMatchingLanguage ? detectLanguage(text) : null) ?? locale ?? null;
  if (language === null) {
    return voice;
  }

  return pickVoice({
    voices: await loadVoices().catch(() => []),
    locale: language,
    preferredVoice: voice
  });
}

async function speak(request: SpeakRequest) {
  const text = request.text.trim();
  if (!text) {
    return IDLE_STATE;
  }

  const savedSettings = await readSettings();
  const [voice] = await Promise.all([
    chooseVoice({
      text,
      voice: request.voice ?? savedSettings.voice,
      isMatchingLanguage: request.isMatchingLanguage ?? savedSettings.isMatchingLanguage,
      locale: request.locale
    }),
    ensureOffscreen()
  ]);
  return speechMessenger.sendMessage(SpeechMessage.PlayerSpeak, {
    text,
    voice,
    prosody: {
      ...DEFAULT_PROSODY,
      rate: request.rate ?? savedSettings.rate
    }
  });
}

// Nothing to control while the player is closed, and waking it just to answer would start it silent
async function control(command: ControlCommand) {
  const isPlayerOpen = await hasOffscreen();
  if (!isPlayerOpen) {
    return IDLE_STATE;
  }

  return speechMessenger.sendMessage(SpeechMessage.PlayerControl, command);
}

// A narrated page reaches this through the bridge content script, so what it asks for is page data
function speakValidated(request: unknown) {
  const parsed = speakRequestSchema.safeParse(request);
  return parsed.success ? speak(parsed.data) : Promise.resolve(IDLE_STATE);
}

function controlValidated(command: unknown) {
  const parsed = controlCommandSchema.safeParse(command);
  return parsed.success ? control(parsed.data) : Promise.resolve(IDLE_STATE);
}

// The popup and other extensions have no tab of their own, and hear the player over the runtime anyway
function rememberFrame({ tab, frameId }: {
  tab?: { id?: number };
  frameId?: number;
}) {
  if (tab?.id === undefined || frameId === undefined) {
    return;
  }

  readingFrame = {
    tabId: tab.id,
    frameId
  };
}

async function relayStateToFrame(state: SpeakingState) {
  if (readingFrame === null) {
    return;
  }

  await speechMessenger.sendMessage(SpeechMessage.PlayerState, state, readingFrame);
}

export default defineBackground(async () => {
  speechMessenger.onMessage(SpeechMessage.Speak, ({ data, sender }) => {
    rememberFrame(sender);
    return speakValidated(data);
  });
  speechMessenger.onMessage(SpeechMessage.Control, ({ data, sender }) => {
    rememberFrame(sender);
    return controlValidated(data);
  });
  speechMessenger.onMessage(SpeechMessage.PlayerState, ({ data }) => relayStateToFrame(data));

  browser.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    const parsed = externalRequestSchema.safeParse(message);
    if (!parsed.success) {
      return false;
    }

    const { type } = parsed.data;
    const answer = type === Command.Speak ? speak(parsed.data) : control(type);
    // Chrome keeps sendResponse alive only for a listener that returned true synchronously, so the
    // answer rides the promise instead of an await here - "return a literal true (not just a truthy
    // value) ... will keep the message channel open to the other end until sendResponse is called"
    // https://developer.chrome.com/docs/extensions/develop/concepts/messaging
    answer.then(sendResponse, () => sendResponse(IDLE_STATE));
    return true;
  });

  // Every listener above is registered before this first await, or an event that woke the service
  // worker would arrive before it is listening - handlers must be "registered synchronously on initial
  // script execution, which enables Chrome to dispatch events to the service worker as soon as it starts"
  // https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events
  await installHeaderRule();
});
