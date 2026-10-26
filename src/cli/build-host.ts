// Usage: pnpm build:host <dir>
// Writes what an app needs to host narrated pages: the narration runtime it embeds in each page
// (narration-runtime.js) and the Node module that lists voices and records clips (narration-service.mjs)

import { bundleRuntime } from "./runtime-bundle";
import { getErrorMessage } from "@/lib/errors";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USAGE = "Usage: pnpm build:host <dir>";
const SERVICE_ENTRY = path.join(import.meta.dirname, "..", "narration-host", "service.ts");
const RUNTIME_FILE = "narration-runtime.js";
const SERVICE_FILE = "narration-service.mjs";
// node22 is the floor whose global WebSocket is undici's and takes the headers openEdgeSocket sets
// https://nodejs.org/api/globals.html#websocket
const SERVICE_TARGET = "node22";

async function main() {
  const [directoryArgument] = process.argv.slice(2);
  if (!directoryArgument) {
    throw new Error(USAGE);
  }

  // pnpm --dir runs scripts in the repo, INIT_CWD is where the caller ran it
  const directory = path.resolve(process.env.INIT_CWD ?? process.cwd(), directoryArgument);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, RUNTIME_FILE), await bundleRuntime());
  await build({
    entryPoints: [SERVICE_ENTRY],
    outfile: path.join(directory, SERVICE_FILE),
    bundle: true,
    platform: "node",
    format: "esm",
    target: SERVICE_TARGET
  });
  console.log(`Wrote ${RUNTIME_FILE} and ${SERVICE_FILE} into ${directory}`);
}

await main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
