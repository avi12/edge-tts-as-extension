import { z } from "@/lib/zod";

// All three are ours, nothing requires them: a command that has not answered in five seconds is a
// bug worth surfacing, and the poll pair gives the browser twenty seconds to open its port
const COMMAND_TIMEOUT_MS = 5000;
const PORT_POLL_MS = 250;
const PORT_ATTEMPTS = 80;

// Every field read below is spelled in the same Chromium http handler the two endpoints are (linked on
// fetchJson): /json/list's entries in SerializeDescriptor, which sets id from the agent host's id, type
// from whatever type the host reports, url from its url, and a per-target webSocketDebuggerUrl. It sets
// that last one on every entry, so the optional here is ours - a guard, not a protocol fact. The two
// type values this loop looks for are named in reload.ts
const targetSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  webSocketDebuggerUrl: z.string().optional()
});

// /json/version's own branch of that handler sets a browser-wide webSocketDebuggerUrl next to version
// strings this loop has no use for
const browserSchema = z.object({ webSocketDebuggerUrl: z.string() });

// The envelope around every command. No reference page states its shape - Chromium's protocol
// dispatcher is what reads id, method, params and sessionId off a command and writes back id plus
// either result or an error of code and message, of which only the message is surfaced here. The id is
// ours: the dispatcher pairs a response to whatever number the command carried, so a counter does
// https://chromium.googlesource.com/chromium/src/+/main/third_party/inspector_protocol/crdtp/dispatch.cc
const responseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional()
});

export type DebugTarget = z.infer<typeof targetSchema>;

// The debugging port answers two HTTP endpoints this loop needs: /json/version, which carries the
// browser-wide WebSocket url, and /json/list, which lists every attachable target. Neither has a
// reference page - Chromium's http handler is where they are defined
// https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/devtools_http_handler.cc
async function fetchJson({ port, path }: {
  port: number;
  path: string;
}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) {
    throw new Error(`The browser's debug endpoint answered ${response.status}`);
  }

  return response.json();
}

// The browser needs a moment before its debugging port answers
export async function waitForDebugPort(port: number) {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const isUp = await fetchJson({
      port,
      path: "/json/version"
    }).then(() => true, () => false);
    if (isUp) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, PORT_POLL_MS));
  }

  return false;
}

export async function listTargets(port: number) {
  return z.array(targetSchema).parse(
    await fetchJson({
      port,
      path: "/json/list"
    })
  );
}

// One connection, many commands - a session id addresses a target attached to this connection, the
// "flat" access the protocol documents on Target.attachToTarget
// https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-attachToTarget
export async function connectCdp(socketUrl: string) {
  const socket = new WebSocket(socketUrl);
  const pendingCommands = new Map<number, (response: z.infer<typeof responseSchema>) => void>();
  let lastCommandId = 0;

  socket.onmessage = e => {
    const parsed = responseSchema.safeParse(JSON.parse(String(e.data)));
    if (!parsed.success) {
      return;
    }

    pendingCommands.get(parsed.data.id)?.(parsed.data);
    pendingCommands.delete(parsed.data.id);
  };

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`Could not reach ${socketUrl}`));
  });

  function send({ method, params, sessionId }: {
    method: string;
    params?: Record<string, unknown>;
    sessionId?: string;
  }) {
    lastCommandId += 1;
    const id = lastCommandId;
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        sessionId
      })
    );
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error(`${method} timed out`)), COMMAND_TIMEOUT_MS);
      pendingCommands.set(id, response => {
        clearTimeout(timeoutId);

        if (response.error) {
          reject(new Error(`${method}: ${response.error.message}`));
          return;
        }

        resolve(response.result);
      });
    });
  }

  return {
    send,
    close: () => socket.close()
  };
}

export async function connectToBrowser(port: number) {
  const { webSocketDebuggerUrl } = browserSchema.parse(
    await fetchJson({
      port,
      path: "/json/version"
    })
  );
  return connectCdp(webSocketDebuggerUrl);
}
