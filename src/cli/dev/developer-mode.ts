import { connectCdp, connectToBrowser, listTargets } from "./cdp";
import { z } from "@/lib/zod";

// The tail both browsers' extensions pages share (edge://extensions/, chrome://extensions/), so one
// string serves as the url to open and the substring to find the target again
const EXTENSIONS_PAGE = "extensions/";
// ours: the page is a WebUI that paints its shadow tree after load, so the expression is retried for
// four seconds rather than raced once
const TOGGLE_WAIT_MS = 400;
const TOGGLE_ATTEMPTS = 10;

const createdTargetSchema = z.object({ targetId: z.string() });

// Chromium 137 and up disable an unpacked extension until the profile turns developer mode on, and
// that preference is signed, so editing the profile on disk is reset on startup. The switch lives in
// two shapes: Edge's own extensions page, and Chromium's.
// Chromium's is a cr-toggle with id devMode, which its source names:
// https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/resources/extensions/toolbar.html.ts
// Edge's developer-mode-switch host and its fluent-switch inside are not in any public source - both
// were read off the live page, which is also why the role and checkbox fallbacks are there
const TOGGLE_EXPRESSION = `(() => {
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
  const host = findDeep(document, el => el.tagName.toLowerCase() === "developer-mode-switch");
  const control = host?.shadowRoot?.querySelector("fluent-switch, [role='switch'], input[type='checkbox']")
    ?? findDeep(document, el => el.id === "devMode");
  if (!control) {
    return "no switch";
  }

  const isOn = control.getAttribute("aria-checked") === "true" || control.checked === true;
  if (isOn) {
    return "already on";
  }

  control.click();
  return "turned on";
})()`;

async function findExtensionsPage(port: number) {
  const targets = await listTargets(port);
  return targets.find(target => target.url.includes(EXTENSIONS_PAGE) && target.webSocketDebuggerUrl);
}

export async function enableDeveloperMode({ port, browserUrl }: {
  port: number;
  browserUrl: string;
}) {
  const browser = await connectToBrowser(port);
  // The three documented protocol methods this needs: open the page, run the hunt inside it, put it
  // away. returnByValue is what brings the expression's string back rather than a remote handle.
  // createTarget takes only its required url and returns the targetId closeTarget is handed back; the
  // one default this leans on is background false, since a page opened behind the window never paints
  // the shadow tree the expression goes looking for. Runtime.evaluate's expression is required too
  // https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createTarget
  // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#method-evaluate
  // https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-closeTarget
  const { targetId } = createdTargetSchema.parse(
    await browser.send({
      method: "Target.createTarget",
      params: {
        url: `${browserUrl}${EXTENSIONS_PAGE}`
      }
    })
  );

  for (let attempt = 0; attempt < TOGGLE_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, TOGGLE_WAIT_MS));
    const page = await findExtensionsPage(port);
    if (!page?.webSocketDebuggerUrl) {
      continue;
    }

    const connection = await connectCdp(page.webSocketDebuggerUrl);
    const result = await connection.send({
      method: "Runtime.evaluate",
      params: {
        expression: TOGGLE_EXPRESSION,
        returnByValue: true
      }
    });
    connection.close();
    // Runtime.evaluate answers with a RemoteObject under result, whose value is where returnByValue
    // puts a JSON value - here the expression's own string, so the three outcomes below are ours. The
    // exceptionDetails it may send beside it is left alone: a throw reads the same as no switch found
    // https://chromedevtools.github.io/devtools-protocol/tot/Runtime/#type-RemoteObject
    const outcome = z.object({ result: z.object({ value: z.string() }) }).safeParse(result);
    const isSettled = outcome.success && outcome.data.result.value !== "no switch";
    if (isSettled) {
      await browser.send({
        method: "Target.closeTarget",
        params: {
          targetId
        }
      });
      browser.close();
      return outcome.data.result.value;
    }
  }

  browser.close();
  return "could not find the developer mode switch";
}
