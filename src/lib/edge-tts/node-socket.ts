import { EDGE_USER_AGENT } from "./constants";

// Node only: undici's WebSocket takes headers, standing in for the extension's declarativeNetRequest rule
export function openEdgeSocket(url: string) {
  return new WebSocket(url, {
    // @ts-expect-error undici accepts a headers option
    headers: {
      "User-Agent": EDGE_USER_AGENT
    }
  });
}
