import { connectCdp, connectToBrowser, type DebugTarget, listTargets } from "./cdp";
import { z } from "@/lib/zod";

const EXTENSION_SCHEME = "chrome-extension://";
const PAGE_TYPE = "page";
const SERVICE_WORKER_TYPE = "service_worker";
const PATTERN_WILDCARD = "*";
const HOST_WILDCARD = "[^/]*";
const PATH_WILDCARD = ".*";
const REGEXP_CHARACTERS = /[.+?^${}()|[\]\\]/g;
const MATCH_PATTERN = /^([^:]+):\/\/([^/]+)(\/.*)$/;
const RELOAD_EXPRESSION = "chrome.runtime.reload()";
const NEW_CONTEXT_WAIT_MS = 100;
const NEW_CONTEXT_ATTEMPTS = 25;
const POPUP_PATH = "popup.html";
const OFFSCREEN_PATH = "offscreen.html";

const createdTargetSchema = z.object({ targetId: z.string() });
const attachedSessionSchema = z.object({ sessionId: z.string() });

// The browser also hosts its own extensions, so only this one's contexts count. Its service worker
// idles out and the offscreen document only lives while something plays, so whichever context
// happens to be up gets to call the reload
function findExtensionTarget({ targets, origin }: {
  targets: DebugTarget[];
  origin: string;
}) {
  const ownTargets = targets.filter(target => target.url.startsWith(origin));
  return ownTargets.find(target => target.url.endsWith(OFFSCREEN_PATH))
    ?? ownTargets.find(target => target.type === SERVICE_WORKER_TYPE)
    ?? ownTargets[0];
}

async function listExtensionTargetIds({ port, origin }: {
  port: number;
  origin: string;
}) {
  const targets = await listTargets(port);
  return new Set(targets.filter(target => target.url.startsWith(origin)).map(target => target.id));
}

// chrome.runtime.reload() drops every context the extension had and starts the new build a moment
// later. A page reloaded inside that gap is left with no content script at all, so the loop waits
// for a context the old build did not have - the new one announcing itself
async function waitForNewExtensionContext({ port, origin, previousIds }: {
  port: number;
  origin: string;
  previousIds: Set<string>;
}) {
  for (let attempt = 0; attempt < NEW_CONTEXT_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, NEW_CONTEXT_WAIT_MS));
    const currentIds = await listExtensionTargetIds({
      port,
      origin
    });
    const isNewContextUp = [...currentIds].some(id => !previousIds.has(id));
    if (isNewContextUp) {
      return true;
    }
  }

  return false;
}

async function reloadThroughTarget({ socketUrl }: { socketUrl: string }) {
  const connection = await connectCdp(socketUrl);
  await connection.send({
    method: "Runtime.evaluate",
    params: {
      expression: RELOAD_EXPRESSION
    }
  });
  connection.close();
}

// With no context of its own alive, the extension gets one: its popup, opened in the background
// just long enough to reload from, then closed
async function reloadThroughNewPopup({ port, origin }: {
  port: number;
  origin: string;
}) {
  const browser = await connectToBrowser(port);
  const { targetId } = createdTargetSchema.parse(
    await browser.send({
      method: "Target.createTarget",
      params: {
        url: `${origin}${POPUP_PATH}`,
        background: true
      }
    })
  );
  const { sessionId } = attachedSessionSchema.parse(
    await browser.send({
      method: "Target.attachToTarget",
      params: {
        targetId,
        flatten: true
      }
    })
  );
  await browser.send({
    method: "Runtime.evaluate",
    params: {
      expression: RELOAD_EXPRESSION
    },
    sessionId
  }).catch(() => {});
  await browser.send({
    method: "Target.closeTarget",
    params: {
      targetId
    }
  }).catch(() => {});
  browser.close();
}

// A wildcard in the host stops at the first slash, or "*.example.com" would also match any URL
// carrying that host further along, in a query string
function expandWildcards({ part, wildcard }: {
  part: string;
  wildcard: string;
}) {
  return part.replaceAll(REGEXP_CHARACTERS, String.raw`\$&`).replaceAll(PATTERN_WILDCARD, wildcard);
}

// Reloading the extension re-registers its content scripts but does not re-run them where they are
// already injected, so the pages they match are reloaded too. A match pattern says nothing about the
// port, so any port on the matched host counts
function toUrlPattern(matchPattern: string) {
  const match = MATCH_PATTERN.exec(matchPattern);
  if (!match) {
    return null;
  }

  const [, scheme = "", host = "", path = ""] = match;
  return new RegExp(`^${expandWildcards({
    part: scheme,
    wildcard: HOST_WILDCARD
  })}://${expandWildcards({
    part: host,
    wildcard: HOST_WILDCARD
  })}(?::\\d+)?${expandWildcards({
    part: path,
    wildcard: PATH_WILDCARD
  })}$`);
}

function isInjectedPage({ target, patterns }: {
  target: DebugTarget;
  patterns: RegExp[];
}) {
  return target.type === PAGE_TYPE && patterns.some(pattern => pattern.test(target.url));
}

export async function reloadMatchingPages({ port, matchPatterns }: {
  port: number;
  matchPatterns: string[];
}) {
  const patterns = matchPatterns.flatMap(matchPattern => toUrlPattern(matchPattern) ?? []);
  const targets = await listTargets(port);
  const injectedPages = targets.filter(target => isInjectedPage({
    target,
    patterns
  }));
  for (const page of injectedPages) {
    if (!page.webSocketDebuggerUrl) {
      continue;
    }

    const connection = await connectCdp(page.webSocketDebuggerUrl);
    await connection.send({ method: "Page.reload" });
    connection.close();
  }

  return injectedPages.length;
}

export async function reloadExtension({ port, extensionId }: {
  port: number;
  extensionId: string;
}) {
  const origin = `${EXTENSION_SCHEME}${extensionId}/`;
  const previousIds = await listExtensionTargetIds({
    port,
    origin
  });
  const target = findExtensionTarget({
    targets: await listTargets(port),
    origin
  });
  if (target?.webSocketDebuggerUrl) {
    await reloadThroughTarget({ socketUrl: target.webSocketDebuggerUrl });
  } else {
    await reloadThroughNewPopup({
      port,
      origin
    });
  }

  return waitForNewExtensionContext({
    port,
    origin,
    previousIds
  });
}
