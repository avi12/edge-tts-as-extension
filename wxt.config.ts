import { defineConfig } from "wxt";

// WXT defaults to entrypoints at the repo root and public/ beside them; keeping everything under src/
// is our layout choice, and publicDir has to be repointed to follow it
// https://wxt.dev/guide/essentials/project-structure.html
export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifest: {
    // Our store listing copy
    name: "Edge Read Aloud",
    description: "Read any text aloud with Microsoft Edge's online neural voices",
    // One permission per thing the extension actually does: rewrite the handshake's User-Agent, keep an
    // audio element alive outside the service worker, remember settings. The WithHostAccess variant
    // shows no install-time warning, but "you must request host permissions before you can perform any
    // action on a host" - which is what the list below grants
    // https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#permissions
    permissions: [
      "declarativeNetRequestWithHostAccess",
      "offscreen",
      "storage"
    ],
    // The two hosts the client talks to, from research/README.md: the voice list stayed on bing, while
    // Edge 155 moved synthesis onto the CETO gateway. A match pattern's scheme is matched literally, and
    // Chrome's own doc lists only http, https and file - so the wss entry is ours, spelled out next to
    // the https one for the same host rather than assumed to be covered by it
    // https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
    host_permissions: [
      "https://speech.platform.bing.com/*",
      "https://api.msedgeservices.com/*",
      "wss://api.msedgeservices.com/*"
    ]
  }
});
