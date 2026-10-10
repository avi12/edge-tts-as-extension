import { createHash } from "node:crypto";

// All three come from Chromium's own GenerateIdForPath: 16 bytes of digest written as 32 hex digits,
// then shifted into the a-p alphabet so an id can never read as a number
const ID_LENGTH = 32;
const HEX_RADIX = 16;
const FIRST_ID_LETTER = "a".charCodeAt(0);

// Chromium derives an unpacked extension's id from its own path: the first 16 bytes of
// SHA-256 over the native absolute path (UTF-16 on Windows), each hex digit mapped onto a-p
// https://chromium.googlesource.com/chromium/src/+/main/components/crx_file/id_util.cc
export function extensionIdForPath(directory: string) {
  const digest = createHash("sha256").update(Buffer.from(directory, "utf16le")).digest("hex");
  return Array.from(
    digest.slice(0, ID_LENGTH),
    hexDigit => String.fromCharCode(FIRST_ID_LETTER + parseInt(hexDigit, HEX_RADIX))
  ).join("");
}
