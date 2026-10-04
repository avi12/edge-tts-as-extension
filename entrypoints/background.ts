import {
  DEFAULT_PROSODY,
  EDGE_EXTENSION_ORIGIN,
  EDGE_USER_AGENT,
  SERVICE_HOST,
} from '@/lib/edge-tts';
import {
  Command,
  IDLE_STATE,
  OFFSCREEN_TARGET,
  type PlayerRequest,
  type PlayerState,
  type Request,
} from '@/lib/messages';
import { settings } from '@/lib/settings';

const OFFSCREEN_PATH = '/offscreen.html';
const HEADER_RULE_ID = 1;
const MENU_READ = 'read-aloud';
const MENU_STOP = 'stop-reading';

export default defineBackground(() => {
  installHeaderRule();

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_READ,
      title: 'Read aloud',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_STOP,
      title: 'Stop reading',
      contexts: ['all'],
    });
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_READ && info.selectionText) {
      handle({ type: Command.Speak, text: info.selectionText });
    } else if (info.menuItemId === MENU_STOP) {
      handle({ type: Command.Stop });
    }
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== 'read-selection' || tab?.id === undefined) return;
    const [result] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => getSelection()?.toString() ?? '',
    });
    const text = result?.result;
    if (text) handle({ type: Command.Speak, text });
  });

  // From the popup. Messages tagged for the offscreen player pass through.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target === OFFSCREEN_TARGET || !isRequest(message)) return;
    handle(message).then(sendResponse);
    return true;
  });

  // Other extensions can drive the reader:
  // chrome.runtime.sendMessage(EXTENSION_ID, { type: 'speak', text: '…' })
  browser.runtime.onMessageExternal.addListener(
    (message, _sender, sendResponse) => {
      if (!isRequest(message)) return;
      handle(message).then(sendResponse);
      return true;
    },
  );
});

/**
 * The service only accepts handshakes that carry Edge's extension Origin and
 * an Edge User-Agent. Rewrite both, but only for this extension's requests.
 */
async function installHeaderRule() {
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [HEADER_RULE_ID],
    addRules: [
      {
        id: HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: EDGE_EXTENSION_ORIGIN },
            { header: 'User-Agent', operation: 'set', value: EDGE_USER_AGENT },
          ],
        },
        condition: {
          requestDomains: [SERVICE_HOST],
          initiatorDomains: [browser.runtime.id],
          resourceTypes: ['websocket', 'xmlhttprequest'],
        },
      },
    ],
  });
}

function isRequest(message: unknown): message is Request {
  const type = (message as Request | undefined)?.type;
  return Object.values(Command).includes(type as Request['type']);
}

async function handle(request: Request): Promise<PlayerState> {
  if (request.type === Command.Speak) {
    const text = request.text?.trim();
    if (!text) return IDLE_STATE;
    const saved = await settings.getValue();
    await ensureOffscreen();
    return toPlayer({
      type: Command.Speak,
      text,
      voice: request.voice ?? saved.voice,
      prosody: { ...DEFAULT_PROSODY, rate: request.rate ?? saved.rate },
    });
  }
  // Nothing to control (or report) when the player isn't running.
  if (!(await hasOffscreen())) return IDLE_STATE;
  return toPlayer(request);
}

function toPlayer(request: PlayerRequest): Promise<PlayerState> {
  return browser.runtime.sendMessage({ ...request, target: OFFSCREEN_TARGET });
}

async function hasOffscreen() {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

let creating: Promise<void> | null = null;

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      // AUDIO_PLAYBACK alone gets the document closed after 30 s of silence,
      // which would kill a paused reading. BLOBS is also true: the audio is
      // streamed through a MediaSource object URL.
      reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
      justification: 'Streams synthesized speech into an audio element',
    })
    .finally(() => (creating = null));
  await creating;
}
