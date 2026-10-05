// Usage: pnpm icons
// Renders the extension icon SVGs into the PNG sizes Edge uses: the manifest icons WXT picks up from
// public/icon (16 toolbar, 32 Windows, 48 extensions page, 128 install dialog) and the 300 px Partner Center logo

import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..");
const ICON_SOURCE = path.join(ROOT, "src", "icon", "icon.svg");
// Under 32 px the full icon turns to mush, so the toolbar size gets its own pixel-snapped drawing
const SMALL_ICON_SOURCE = path.join(ROOT, "src", "icon", "icon-16.svg");
const MANIFEST_ICON_DIRECTORY = path.join(ROOT, "src", "public", "icon");
const STORE_DIRECTORY = path.join(ROOT, "store");
const SMALL_ICON_SIZE = 16;
const MANIFEST_ICON_SIZES = [SMALL_ICON_SIZE, 32, 48, 128];
const STORE_LOGO_SIZE = 300;

async function renderPng({ source, size, destination }: {
  source: string;
  size: number;
  destination: string;
}) {
  const svg = await readFile(source, "utf8");
  const png = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: size
    }
  }).render().asPng();
  await writeFile(destination, png);
  console.log(`${size}px  ${path.relative(ROOT, destination)}`);
}

await mkdir(MANIFEST_ICON_DIRECTORY, { recursive: true });
await mkdir(STORE_DIRECTORY, { recursive: true });
for (const size of MANIFEST_ICON_SIZES) {
  await renderPng({
    source: size === SMALL_ICON_SIZE ? SMALL_ICON_SOURCE : ICON_SOURCE,
    size,
    destination: path.join(MANIFEST_ICON_DIRECTORY, `${size}.png`)
  });
}

await renderPng({
  source: ICON_SOURCE,
  size: STORE_LOGO_SIZE,
  destination: path.join(STORE_DIRECTORY, `logo-${STORE_LOGO_SIZE}.png`)
});
