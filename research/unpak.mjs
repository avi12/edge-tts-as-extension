// Dumps every resource from a Chromium resources.pak (Edge: u32 version, u32 encoding, u32 count,
// u32 alias count, then { u32 id, u32 offset } entries)
// Usage: node research/unpak.mjs <resources.pak> <output dir>
import fs from "node:fs";
import zlib from "node:zlib";

const COUNT_OFFSET = 8;
const ENTRIES_OFFSET = 16;
const ENTRY_SIZE = 8;
const ID_SIZE = 4;
const LOGGED_ENTRIES = 3;
const GZIP_MAGIC = [0x1f, 0x8b];
const BROTLI_MAGIC = [0x1e, 0x9b];
const BROTLI_HEADER_SIZE = 8;

const [, , inputPath, outputDir] = process.argv;
const pak = fs.readFileSync(inputPath);
const count = pak.readUInt32LE(COUNT_OFFSET);

function hasMagic({ data, magic }) {
  return data[0] === magic[0] && data[1] === magic[1];
}

function decompress(data) {
  if (hasMagic({
    data,
    magic: GZIP_MAGIC
  })) {
    return zlib.gunzipSync(data);
  }

  if (hasMagic({
    data,
    magic: BROTLI_MAGIC
  })) {
    return zlib.brotliDecompressSync(data.subarray(BROTLI_HEADER_SIZE));
  }

  return data;
}

function decompressOrKeep(data) {
  try {
    return decompress(data);
  } catch {
    return data;
  }
}

function readEntryOffset(i) {
  return pak.readUInt32LE(ENTRIES_OFFSET + i * ENTRY_SIZE + ID_SIZE);
}

fs.mkdirSync(outputDir, { recursive: true });
let writtenCount = 0;
for (let i = 0; i < count; i++) {
  const id = pak.readUInt32LE(ENTRIES_OFFSET + i * ENTRY_SIZE);
  const offset = readEntryOffset(i);
  const nextOffset = readEntryOffset(i + 1);
  fs.writeFileSync(`${outputDir}/${id}`, decompressOrKeep(pak.subarray(offset, nextOffset)));
  writtenCount++;

  if (i < LOGGED_ENTRIES) {
    console.log(id, offset, nextOffset);
  }
}

console.log("written", writtenCount);
