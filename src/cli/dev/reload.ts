import { connectCdp, connectToBrowser, type DebugTarget, listTargets } from "./cdp";
import { z } from "@/lib/zod";

// documented: every resource of an extension is served from this scheme plus the extension id
// https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources
const EXTENSION_SCHEME = "chrome-extension://";
// The target type strings the debug endpoint reports. The protocol leaves the field a plain string
// and points at Chromium's own list, where these two are spelled
// https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_agent_host_impl.cc
const PAGE_TYPE = "page";
const SERVICE_WORKER_TYPE = "service_worker";
// The pattern side is the documented match pattern grammar: one wildcard character, a host wildcard
// that may only lead and must be followed by a dot or a slash, a path wildcard matching the rest,
// and no port (an absent port is treated as :*, which is why the url pattern below allows any)
// https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
const PATTERN_WILDCARD = "*";
// The regexp side is ours: the translation that gives those three their meaning in a RegExp
const HOST_WILDCARD = "[^/]*";
const PATH_WILDCARD = ".*";
const REGEXP_CHARACTERS = /[.+?^${}()|[\]\\]/g;
const MATCH_PATTERN = /^([^:]+):\/\/([^/]+)(\/.*)$/;
// documented: the extension's own API for restarting itself, which is the only reload that picks up
// changed files - there is no protocol method for it, hence the trip through a live context below
// https://developer.chrome.com/docs/extensions/reference/api/runtime#method-reload
const RELOAD_EXPRESSION = "chrome.runtime.reload()";
const EXTENSIONS_PAGE = "extensions/";
const RELOAD_BUTTON_LABEL = "Reload";
// The extensions page's own Reload control, found the way the developer-mode switch is: by walking
// every shadow root, because Edge's page and Chromium's spell the button differently
const CLICK_RELOAD_EXPRESSION = `(() => {
  const findDeep = (root, match) => {
    for (const el of root.querySelectorAll("*")) {
      if (match(el)) {
        return el;
      }

      const found = el.shadowRoot && findDeep(el.shadowRoot, match);
      if (found) {
        return found;
      }
    }
    return null;
  };
  const isReloadButton = el => {
    const isButton = /button/i.test(el.tagName) || el.getAttribute("role") === "button";
    const label = el.getAttribute("aria-label") || "";
    const text = el.textContent ? el.textContent.trim() : "";
    return isButton && (/reload/i.test(el.id) || label === "${RELOAD_BUTTON_LABEL}" || text === "${RELOAD_BUTTON_LABEL}");
  };
  const button = findDeep(document, isReloadButton);
  if (!button) {
    return "no reload button";
  }

  button.click();
  return "clicked";
})()`;
const NEW_CONTEXT_WAIT_MS = 100;
const NEW_CONTEXT_ATTEMPTS = 25;
// WXT builds each HTML entrypoint to its own name at the extension root, so these are our entrypoint
// names rather than anything the browser fixes
// https://wxt.dev/guide/essentials/entrypoints
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

// Runtime.evaluate is the protocol's only way into a context's own globals, which is where the
// extension API lives; nothing is read back, so returnByValue is left off. expression is its one
// required parameter, and leaving the rest off relies on their documented defaults - returnByValue
// false hands back a remote handle this never touches, awaitPromise false returns without waiting, and
// the reload tears the context down anyway
// https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate
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
// just long enough to reload from, then closed. background is the documented parameter for opening a
// target without bringing it forward, and flatten is what lets this one connection address it by
// session id instead of a second socket. url is createTarget's one required parameter and targetId its
// one return; attachToTarget takes that targetId and returns the sessionId; closeTarget takes the
// targetId again and its success return is ignored, the popup being gone either way. createTarget's
// remaining parameters are left at their documented defaults, newWindow false above all, so the popup
// opens in the window that is already there
// https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createTarget
// https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-attachToTarget
// https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-closeTarget
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
// port, so any port on the matched host counts. The first half is this repo's finding - watched
// happen in the dev loop, no doc page states it; the port half is in the match pattern reference
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
    // Sent without ignoreCache, so the reload keeps the browser cache the user's own F5 would keep -
    // every parameter the method takes is optional and ignoreCache's documented default is false
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-reload
    await connection.send({ method: "Page.reload" });
    connection.close();
  }

  return injectedPages.length;
}

// chrome.runtime.reload() is throttled: call it a few times in a few minutes, as a save-driven loop
// does, and the browser quietly keeps serving the service worker it already has - the files on disk
// are new while the worker running them is not. Clicking Reload on the extensions page is not
// throttled, and brings the worker back from disk, so that is the way in. The API call stays as the
// fallback for a browser whose page this cannot find
async function reloadThroughExtensionsPage({ port, browserUrl }: {
  port: number;
  browserUrl: string;
}) {
  const browser = await connectToBrowser(port);
  const page = (await listTargets(port)).find(target => target.url.includes(EXTENSIONS_PAGE));
  const targetId = page
    ? page.id
    : createdTargetSchema.parse(
      await browser.send({
        method: "Target.createTarget",
        params: {
          url: `${browserUrl}${EXTENSIONS_PAGE}`
        }
      })
    ).targetId;
  const { sessionId } = attachedSessionSchema.parse(
    await browser.send({
      method: "Target.attachToTarget",
      params: {
        targetId,
        flatten: true
      }
    })
  );
  const outcome = await browser.send({
    method: "Runtime.evaluate",
    params: {
      expression: CLICK_RELOAD_EXPRESSION,
      returnByValue: true
    },
    sessionId
  }).catch(() => null);
  browser.close();
  return z.object({ result: z.object({ value: z.string() }) }).safeParse(outcome).data?.result.value === "clicked";
}

export async function reloadExtension({ port, extensionId, browserUrl }: {
  port: number;
  extensionId: string;
  browserUrl: string;
}) {
  const origin = `${EXTENSION_SCHEME}${extensionId}/`;
  const previousIds = await listExtensionTargetIds({
    port,
    origin
  });
  const isPageReloaded = await reloadThroughExtensionsPage({
    port,
    browserUrl
  });
  if (!isPageReloaded) {
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
  }

  return waitForNewExtensionContext({
    port,
    origin,
    previousIds
  });
}
