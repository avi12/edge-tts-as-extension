// Dev loop that never closes the window: builds the extension, opens one isolated browser with it
// loaded, then rebuilds and reloads the extension in place on every save
// Usage: pnpm dev:edge [--url <page>] [--browser <path to the exe>]
import { launchBrowser, stopBrowser } from "./dev/browser";
import { extensionIdForPath } from "./dev/extension-id";
import { reloadExtension, reloadMatchingPages } from "./dev/reload";
import { NARRATED_SITES } from "@/lib/narrated-sites";
import { watch } from "node:fs";
import path from "node:path";
import { build } from "wxt";

const CDP_PORT = 9223;
const PROFILE_DIRECTORY = ".dev-profile";
const OUTPUT_DIRECTORY = ".output/chrome-mv3";
const WATCHED_PATHS = ["src", "wxt.config.ts"];
const SOURCE_FILE = /\.(?:ts|svelte|css|html|json|svg)$/;
const REBUILD_DEBOUNCE_MS = 120;
const DEFAULT_START_URL = "about:blank";
// Manifest and permission changes only take with a fresh load, so the loop says so instead of
// pretending a reload was enough
const RELOAD_BLIND_FILES = ["wxt.config.ts"];

const projectRoot = process.env.INIT_CWD ?? process.cwd();

function resolveInProject(relativePath: string) {
  return path.resolve(projectRoot, relativePath);
}

function readOption(name: string) {
  const iOption = process.argv.indexOf(`--${name}`);
  return iOption === -1 ? undefined : process.argv[iOption + 1];
}

function logEvent(message: string) {
  console.log(`[dev ${new Date().toLocaleTimeString()}] ${message}`);
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function buildExtension() {
  const startedAt = Date.now();
  await build();
  return Date.now() - startedAt;
}

async function reloadInPlace() {
  await reloadExtension({
    port: CDP_PORT,
    extensionId
  });
  return reloadMatchingPages({
    port: CDP_PORT,
    matchPatterns: NARRATED_SITES
  });
}

async function rebuildAndReload(changedFile: string) {
  const buildMs = await buildExtension().catch((error: unknown) => {
    logEvent(`Build failed: ${describeError(error)}`);
    return null;
  });
  if (buildMs === null) {
    return;
  }

  const isReloadBlind = RELOAD_BLIND_FILES.some(file => changedFile.endsWith(file));
  if (isReloadBlind) {
    logEvent(`Built in ${buildMs}ms - ${changedFile} changes the manifest, so reopen the browser to pick it up`);
    return;
  }

  const pageCount = await reloadInPlace().catch((error: unknown) => {
    logEvent(`Built in ${buildMs}ms, reload failed: ${describeError(error)}`);
    return null;
  });
  if (pageCount === null) {
    return;
  }

  logEvent(`Built in ${buildMs}ms, reloaded the extension and ${pageCount} page(s) - ${changedFile}`);
}

// A save landing mid-build is not dropped, it starts the next round
async function runRebuilds(firstFile: string) {
  let changedFile: string | null = firstFile;
  while (changedFile !== null) {
    queuedFile = null;
    await rebuildAndReload(changedFile);
    changedFile = queuedFile;
  }
}

function scheduleRebuild(changedFile: string) {
  queuedFile = changedFile;

  if (rebuilding !== null) {
    return;
  }

  clearTimeout(pendingRebuild);
  pendingRebuild = setTimeout(() => {
    rebuilding = runRebuilds(changedFile).finally(() => {
      rebuilding = null;
    });
  }, REBUILD_DEBOUNCE_MS);
}

logEvent(`Building ${OUTPUT_DIRECTORY}`);
await buildExtension();

const extensionDirectory = resolveInProject(OUTPUT_DIRECTORY);
const extensionId = extensionIdForPath(extensionDirectory);
const browser = launchBrowser({
  binary: readOption("browser"),
  profileDirectory: resolveInProject(PROFILE_DIRECTORY),
  extensionDirectory,
  port: CDP_PORT,
  startUrl: readOption("url") ?? DEFAULT_START_URL
});
logEvent(`Browser up on port ${CDP_PORT}, extension ${extensionId}`);
logEvent("Watching for changes - Ctrl+C stops only this browser");

let pendingRebuild: ReturnType<typeof setTimeout> | undefined;
let rebuilding: Promise<void> | null = null;
let queuedFile: string | null = null;

for (const watchedPath of WATCHED_PATHS) {
  watch(resolveInProject(watchedPath), { recursive: true }, (_event, fileName) => {
    const changedFile = fileName ?? watchedPath;
    if (SOURCE_FILE.test(changedFile)) {
      scheduleRebuild(changedFile);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopBrowser(browser.pid);
    process.exit(0);
  });
}
