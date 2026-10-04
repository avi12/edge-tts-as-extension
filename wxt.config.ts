import { KeyboardCommand } from "./src/lib/shortcuts";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  publicDir: "src/public",
  manifest: {
    name: "Edge Read Aloud",
    description: "Read any text aloud with Microsoft Edge's online neural voices",
    permissions: [
      "activeTab",
      "contextMenus",
      "declarativeNetRequestWithHostAccess",
      "offscreen",
      "scripting",
      "storage"
    ],
    host_permissions: ["https://speech.platform.bing.com/*", "wss://speech.platform.bing.com/*"],
    commands: {
      [KeyboardCommand.ReadSelection]: {
        suggested_key: {
          default: "Alt+Shift+R"
        },
        description: "Read the selected text aloud"
      }
    }
  }
});
