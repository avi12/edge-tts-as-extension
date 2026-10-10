import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const EDGE_PATH = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const WINDOW_SIZE = "1280,900";
const LOAD_EXTENSION_BLOCK = "DisableLoadExtensionCommandLineSwitch";

// Its own user data dir, so the dev browser never touches the real, signed-in one - and closing it
// only ever closes the window this script opened. Developer mode is turned on afterwards, over the
// debugging port, because the preference behind it is signed and an edit on disk is reset on startup
export function launchBrowser({ binary = EDGE_PATH, profileDirectory, extensionDirectory, port, startUrl }: {
  binary?: string;
  profileDirectory: string;
  extensionDirectory: string;
  port: number;
  startUrl: string;
}) {
  mkdirSync(profileDirectory, { recursive: true });
  const browser = spawn(binary, [
    `--user-data-dir=${profileDirectory}`,
    // Chromium 137 and up ignore --load-extension unless this is off
    `--disable-features=${LOAD_EXTENSION_BLOCK}`,
    `--load-extension=${extensionDirectory}`,
    `--disable-extensions-except=${extensionDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${WINDOW_SIZE}`,
    startUrl
  ], { stdio: "ignore" });
  browser.unref();
  return browser;
}

// Never by image name: that would take the real browser's windows down with it
export function stopBrowser(pid: number | undefined) {
  if (pid === undefined) {
    return;
  }

  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}
