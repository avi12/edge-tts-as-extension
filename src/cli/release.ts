// Usage: pnpm release [--notes <file>] [--draft]
// Builds the extension, zips it, signs a .crx with the key in keys/, and creates the GitHub release
// with both attached. The version comes from package.json, the tag is v<version>.
//
// The .crx is packed the way Chrome itself packs one: --pack-extension over the built directory plus a
// PKCS#8 private key, which is also what fixes the extension's id for everyone who installs it
// https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux#create

import { getErrorMessage } from "@/lib/errors";
import { z } from "@/lib/zod";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { zip } from "wxt";

const BUILD_TARGET = "chrome-mv3";
const OUTPUT_DIRECTORY = ".output";
const KEY_PATH = "keys/chrome.pem";
// Chrome writes the .crx beside the directory it packed, under that directory's own name
const PACKED_SUFFIX = ".crx";
const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
  String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];

const projectRoot = path.resolve(import.meta.dirname, "..", "..");

function resolveInProject(relativePath: string) {
  return path.resolve(projectRoot, relativePath);
}

const packageSchema = z.object({
  name: z.string(),
  version: z.string()
});

async function readPackage() {
  return packageSchema.parse(JSON.parse(await readFile(resolveInProject("package.json"), "utf8")));
}

async function findFile(candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }

    const isFile = await stat(candidate).then(entry => entry.isFile(), () => false);
    if (isFile) {
      return candidate;
    }
  }

  return null;
}

function run({ command, args }: {
  command: string;
  args: string[];
}) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed`);
  }
}

// A key the repo never carries: it is generated once, stays in gitignored keys/, and signing with the
// same one keeps the extension's id stable across releases
async function packCrx({ buildDirectory, crxPath }: {
  buildDirectory: string;
  crxPath: string;
}) {
  const keyPath = resolveInProject(KEY_PATH);
  const hasKey = await stat(keyPath).then(entry => entry.isFile(), () => false);
  if (!hasKey) {
    throw new Error(`No signing key at ${KEY_PATH} - generate one with "openssl genrsa -out ${KEY_PATH} 2048"`);
  }

  const chromePath = await findFile(CHROME_CANDIDATES);
  if (chromePath === null) {
    throw new Error("No Chrome found to pack the crx - set CHROME_BIN");
  }

  run({
    command: chromePath,
    args: [`--pack-extension=${buildDirectory}`, `--pack-extension-key=${keyPath}`, "--no-message-box"]
  });
  await copyFile(`${buildDirectory}${PACKED_SUFFIX}`, crxPath);
}

async function main() {
  const { values } = parseArgs({
    options: {
      notes: {
        type: "string"
      },
      draft: {
        type: "boolean"
      }
    }
  });
  const { name, version } = await readPackage();
  const tag = `v${version}`;
  const artifacts = resolveInProject(OUTPUT_DIRECTORY);
  const crxPath = path.join(artifacts, `${name}-${version}.crx`);

  // zip() builds first and returns what it wrote, the extension archive ahead of any sources archive
  const [zipPath] = await zip();
  if (zipPath === undefined) {
    throw new Error("wxt zip wrote no archive");
  }

  await mkdir(artifacts, { recursive: true });
  await packCrx({
    buildDirectory: path.join(artifacts, BUILD_TARGET),
    crxPath
  });

  const notesArgs = values.notes ? ["--notes-file", values.notes] : ["--generate-notes"];
  run({
    command: "gh",
    args: [
      "release",
      "create",
      tag,
      zipPath,
      crxPath,
      "--title",
      tag,
      ...notesArgs,
      ...values.draft ? ["--draft"] : []
    ]
  });
  console.log(`Released ${tag} with ${path.basename(zipPath)} and ${path.basename(crxPath)}`);
}

await main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
