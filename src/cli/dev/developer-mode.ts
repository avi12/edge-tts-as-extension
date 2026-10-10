import { connectCdp, connectToBrowser, listTargets } from "./cdp";
import { z } from "@/lib/zod";

const EXTENSIONS_PAGE = "extensions/";
const TOGGLE_WAIT_MS = 400;
const TOGGLE_ATTEMPTS = 10;

const createdTargetSchema = z.object({ targetId: z.string() });

// Chromium 137 and up disable an unpacked extension until the profile turns developer mode on, and
// that preference is signed, so editing the profile on disk is reset on startup. The switch lives in
// two shapes: Edge's own extensions page, and Chromium's
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
