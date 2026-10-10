import { z } from "@/lib/zod";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const EDGE_PATH = String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`;
const WINDOW_SIZE = "1280,900";
const PREFERENCES_PATH = ["Default", "Preferences"];

const preferencesSchema = z.looseObject({
  extensions: z.looseObject({ ui: z.looseObject({}).optional() }).optional(),
  protection: z.unknown().optional()
});

// Chromium turns down an unpacked extension, --load-extension included, unless the profile has
// developer mode on - which a fresh profile does not. Developer mode is a tracked preference, so the
// signatures that would reset an edited one go as well
function enableDeveloperMode(profileDirectory: string) {
  const preferencesFile = path.join(profileDirectory, ...PREFERENCES_PATH);
  mkdirSync(path.dirname(preferencesFile), { recursive: true });
  const preferences = existsSync(preferencesFile)
    ? preferencesSchema.parse(JSON.parse(readFileSync(preferencesFile, "utf8")))
    : {};
  const { protection: _unsigned, ...signedOut } = preferences;
  writeFileSync(
    preferencesFile, JSON.stringify({
      ...signedOut,
      extensions: {
        ...preferences.extensions,
        ui: {
          ...preferences.extensions?.ui,
          developer_mode: true
        }
      }
    })
  );
}

// Its own user data dir, so the dev browser never touches the real, signed-in one - and closing it
// only ever closes the window this script opened
export function launchBrowser({ binary = EDGE_PATH, profileDirectory, extensionDirectory, port, startUrl }: {
  binary?: string;
  profileDirectory: string;
  extensionDirectory: string;
  port: number;
  startUrl: string;
}) {
  mkdirSync(profileDirectory, { recursive: true });
  enableDeveloperMode(profileDirectory);
  const browser = spawn(binary, [
    `--user-data-dir=${profileDirectory}`,
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
