import { z } from "@/lib/zod";

const COMMAND_TIMEOUT_MS = 5000;

const targetSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  webSocketDebuggerUrl: z.string().optional()
});

const browserSchema = z.object({ webSocketDebuggerUrl: z.string() });

const responseSchema = z.object({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional()
});

export type DebugTarget = z.infer<typeof targetSchema>;

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

export async function listTargets(port: number) {
  return z.array(targetSchema).parse(
    await fetchJson({
      port,
      path: "/json/list"
    })
  );
}

// One connection, many commands - a session id addresses a target attached to this connection
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
