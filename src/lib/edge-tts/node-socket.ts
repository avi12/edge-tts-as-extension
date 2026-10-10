import { EDGE_USER_AGENT } from "./constants";

// Node only: undici's WebSocket takes headers, standing in for the extension's declarativeNetRequest rule
// headers is undici's own extension - the WHATWG constructor takes protocols and nothing else, so a
// browser has no way to set one. It is the only place Node can put the Edge User-Agent the gateway
// insists on (research/README.md's probe table)
// https://github.com/nodejs/undici/blob/main/docs/docs/api/WebSocket.md
export function openEdgeSocket(url: string) {
  return new WebSocket(url, {
    // @ts-expect-error undici accepts a headers option
    headers: {
      "User-Agent": EDGE_USER_AGENT
    }
  });
}
