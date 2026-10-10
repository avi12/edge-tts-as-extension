import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  modules: ["@wxt-dev/module-svelte"],
  manifest: {
    name: "Edge Read Aloud",
    description: "Read any text aloud with Microsoft Edge's online neural voices",
    permissions: [
      "declarativeNetRequestWithHostAccess",
      "offscreen",
      "storage"
    ],
    host_permissions: [
      "https://speech.platform.bing.com/*",
      "https://api.msedgeservices.com/*",
      "wss://api.msedgeservices.com/*"
    ]
  }
});
