import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  unlink
} from "node:fs/promises";
import path from "node:path";

// The browser keeps a handle on the files of the extension it loaded, so emptying that directory
// fails while it is open - rmdir comes back EPERM on Windows for whichever folder a live context
// happens to be reading (chunks for a content script, assets for the popup's fonts). The build
// therefore writes to its own directory, and only the files whose bytes changed are copied over the
// loaded ones, which leaves the held files untouched
async function listFiles(directory: string) {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true
  }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(path.relative(directory, path.join(entry.parentPath, entry.name)));
    }
  }

  return files;
}

async function isSameFile({ source, target }: {
  source: string;
  target: string;
}) {
  const [sourceBytes, targetBytes] = await Promise.all([
    readFile(source),
    readFile(target).catch(() => null)
  ]);
  return targetBytes !== null && sourceBytes.equals(targetBytes);
}

// How many files the loaded extension gained or lost, which is what the browser has to reload for
export async function syncExtensionOutput({ from, to }: {
  from: string;
  to: string;
}) {
  const builtFiles = await listFiles(from);
  let changedCount = 0;
  for (const file of builtFiles) {
    const source = path.join(from, file);
    const target = path.join(to, file);
    const isUnchanged = await isSameFile({
      source,
      target
    });
    if (isUnchanged) {
      continue;
    }

    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    changedCount += 1;
  }

  const builtPaths = new Set(builtFiles);
  for (const file of await listFiles(to)) {
    if (builtPaths.has(file)) {
      continue;
    }

    // A file a live context still holds cannot be removed, and a stale hashed chunk does no harm
    await unlink(path.join(to, file)).catch(() => undefined);
  }

  return changedCount;
}
