// Dev loop that never closes the window: builds the extension, opens one isolated browser with it
// loaded, then rebuilds and reloads the extension in place on every save
// Usage: pnpm dev:edge [--url <page>] [--browser <path to the exe>]
import { launchBrowser, stopBrowser } from "./dev/browser";
import { waitForDebugPort } from "./dev/cdp";
import { enableDeveloperMode } from "./dev/developer-mode";
import { extensionIdForPath } from "./dev/extension-id";
import { syncExtensionOutput } from "./dev/output";
import { reloadExtension, reloadMatchingPages } from "./dev/reload";
import { getErrorMessage } from "@/lib/errors";
import { NARRATED_SITES } from "@/lib/narrated-sites";
import { watch } from "node:fs";
import path from "node:path";
import { build } from "wxt";

// ours, one past the 9222 every other debugging tool defaults to, so a browser already listening
// there is left alone
const CDP_PORT = 9223;
// ours, a dotted directory beside the output so it is ignored and thrown away like one
const PROFILE_DIRECTORY = ".dev-profile";
// WXT's default browser target and default manifest version for it; the directory it builds into is
// named after the pair, which is WXT's own naming rather than anything configured here
// https://wxt.dev/guide/essentials/target-different-browsers
const BUILD_TARGET = "chrome-mv3";
// What the browser loaded, and where each rebuild lands before its changed files are copied across
const OUTPUT_DIRECTORY = `.output/${BUILD_TARGET}`;
const STAGING_BASE = ".output/dev-staging";
const STAGING_DIRECTORY = `${STAGING_BASE}/${BUILD_TARGET}`;
// Ours: the paths a build reads, and the file types worth rebuilding for - an editor's swap and lock
// files land in the same tree and would otherwise each cost a build
const WATCHED_PATHS = ["src", "wxt.config.ts"];
const SOURCE_FILE = /\.(?:ts|svelte|css|html|json|svg)$/;
// ours, long enough that one save of several files is one build, short enough to feel immediate
const REBUILD_DEBOUNCE_MS = 120;
// ours, the cheapest page to open when --url says nothing
const DEFAULT_START_URL = "about:blank";
// Each browser serves its own internal pages from its own scheme, and only its own
const EDGE_BROWSER_URL = "edge://";
const CHROMIUM_BROWSER_URL = "chrome://";
// Manifest and permission changes only take with a fresh load, so the loop says so instead of
// pretending a reload was enough. This repo's finding, from watching a permission change not take
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

async function buildExtension() {
  const startedAt = Date.now();
  await build({ outDir: resolveInProject(STAGING_BASE) });
  const changedCount = await syncExtensionOutput({
    from: resolveInProject(STAGING_DIRECTORY),
    to: resolveInProject(OUTPUT_DIRECTORY)
  });
  return {
    buildMs: Date.now() - startedAt,
    changedCount
  };
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
  const built = await buildExtension().catch((error: unknown) => {
    logEvent(`Build failed: ${getErrorMessage(error)}`);
    return null;
  });
  if (built === null) {
    return;
  }

  const { buildMs, changedCount } = built;
  const isReloadBlind = RELOAD_BLIND_FILES.some(file => changedFile.endsWith(file));
  if (isReloadBlind) {
    logEvent(`Built in ${buildMs}ms - ${changedFile} changes the manifest, so reopen the browser to pick it up`);
    return;
  }

  const pageCount = await reloadInPlace().catch((error: unknown) => {
    logEvent(`Built in ${buildMs}ms, reload failed: ${getErrorMessage(error)}`);
    return null;
  });
  if (pageCount === null) {
    return;
  }

  logEvent(
    `Built in ${buildMs}ms, ${changedCount} file(s) changed, `
    + `reloaded the extension and ${pageCount} page(s) - ${changedFile}`
  );
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
const isDebugPortUp = await waitForDebugPort(CDP_PORT);
if (!isDebugPortUp) {
  logEvent(`The browser never opened its debugging port on ${CDP_PORT}`);
  stopBrowser(browser.pid);
  process.exit(1);
}

const browserUrl = readOption("browser") === undefined ? EDGE_BROWSER_URL : CHROMIUM_BROWSER_URL;
const developerMode = await enableDeveloperMode({
  port: CDP_PORT,
  browserUrl
});
logEvent(`Browser up on port ${CDP_PORT}, extension ${extensionId}, developer mode ${developerMode}`);
// An extension that started disabled only runs once developer mode is on
await reloadInPlace().catch(() => undefined);
logEvent("Watching for changes - Ctrl+C stops only this browser");

let pendingRebuild: ReturnType<typeof setTimeout> | undefined;
let rebuilding: Promise<void> | null = null;
let queuedFile: string | null = null;

for (const watchedPath of WATCHED_PATHS) {
  watch(resolveInProject(watchedPath), { recursive: true }, (_event, fileName) => {
    const changedFile = fileName ?? watchedPath;
    const isSourceFile = SOURCE_FILE.test(changedFile);
    if (isSourceFile) {
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
