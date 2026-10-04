// ASCII and UTF-16 strings in a binary, like `strings`
// Usage: node research/strings.mjs <input> <output>
import fs from "node:fs";

const MIN_STRING_LENGTH = 6;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;
const UTF16_PREFIX = "[u16] ";

const [, , inputPath, outputPath] = process.argv;
const bytes = fs.readFileSync(inputPath);

function isPrintable(byte) {
  return byte >= FIRST_PRINTABLE && byte <= LAST_PRINTABLE;
}

function collectStrings({ step, prefix, readCharacter }) {
  const found = [];
  let current = "";
  for (let i = 0; i + step - 1 < bytes.length; i += step) {
    const character = readCharacter(i);
    if (character !== null) {
      current += character;
      continue;
    }

    if (current.length >= MIN_STRING_LENGTH) {
      found.push(`${prefix}${current}`);
    }

    current = "";
  }

  return found;
}

function readAscii(i) {
  const byte = bytes[i];
  return isPrintable(byte) ? String.fromCharCode(byte) : null;
}

function readUtf16(i) {
  const low = bytes[i];
  const isAsciiUtf16 = bytes[i + 1] === 0 && isPrintable(low);
  return isAsciiUtf16 ? String.fromCharCode(low) : null;
}

const asciiStrings = collectStrings({
  step: 1,
  prefix: "",
  readCharacter: readAscii
});
const utf16Strings = collectStrings({
  step: 2,
  prefix: UTF16_PREFIX,
  readCharacter: readUtf16
});
fs.writeFileSync(outputPath, [...asciiStrings, ...utf16Strings].join("\n"));
