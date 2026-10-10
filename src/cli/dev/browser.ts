import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

// Edge's install location on Windows, read off this machine - nothing documents it as a contract,
// which is why --browser exists
const EDGE_PATH = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
// ours, a window big enough to work a narrated page in, nothing requires it
const WINDOW_SIZE = "1280,900";
// The feature name behind the removal below, read off the browser's own feature list - no doc page
// names it, only the removal it implements
const LOAD_EXTENSION_BLOCK = "DisableLoadExtensionCommandLineSwitch";

// Its own user data dir, so the dev browser never touches the real, signed-in one - and closing it
// only ever closes the window this script opened. Developer mode is turned on afterwards, over the
// debugging port, because the preference behind it is signed and an edit on disk is reset on startup
// (that last part is this repo's finding, from watching the profile get reset). --user-data-dir is
// documented as the switch that moves the whole profile tree:
// https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md
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
    // https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY
    `--disable-features=${LOAD_EXTENSION_BLOCK}`,
    `--load-extension=${extensionDirectory}`,
    `--disable-extensions-except=${extensionDirectory}`,
    // Loopback only: the debugging port drives the whole browser, so nothing off this machine may
    // reach it. Our choice, the switch itself takes any address
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    // The offscreen player starts audio with no click behind it, which the default policy blocks;
    // this value is Chrome's documented way to turn the policy off
    // https://developer.chrome.com/blog/autoplay
    "--autoplay-policy=no-user-gesture-required",
    // Chromium's own switches - a brand-new profile otherwise opens on the first-run flow instead of
    // the page, and asks to be made the default browser
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${WINDOW_SIZE}`,
    startUrl
  ], { stdio: "ignore" });
  browser.unref();
  return browser;
}

// Never by image name: that would take the real browser's windows down with it. /T ends the renderer
// children too, /F does it without asking, both documented:
// https://learn.microsoft.com/windows-server/administration/windows-commands/taskkill
export function stopBrowser(pid: number | undefined) {
  if (pid === undefined) {
    return;
  }

  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}
