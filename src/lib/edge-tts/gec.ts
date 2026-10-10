import { TICKS_PER_SECOND, TRUSTED_CLIENT_TOKEN } from "./constants";

// Seconds from the Unix epoch back to 1601-01-01, where Windows file time starts counting its
// 100 ns intervals
// https://learn.microsoft.com/windows/win32/api/minwinbase/ns-minwinbase-filetime
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600n;

// Edge's native code rounds the ticks down to 5 minutes, and the gateway takes the current window plus
// one either side (research/README.md)
const TOKEN_WINDOW_SECONDS = 300n;
const MILLISECONDS_PER_SECOND = 1000;

// microsoft_genuine_edge_token.cc hashes with SHA-256 (research/README.md); the name is Web Crypto's
// https://developer.mozilla.org/docs/Web/API/SubtleCrypto/digest
const DIGEST_ALGORITHM = "SHA-256";
const HEX_RADIX = 16;
const HEX_BYTE_LENGTH = 2;

// Sec-MS-GEC, as Edge's native code computes it: SHA-256 of the Windows file time rounded down to
// 5 minutes (in 100 ns ticks) followed by the trusted client token, as upper-case hex
export async function secMsGec(nowMs = Date.now()) {
  let seconds = BigInt(Math.floor(nowMs / MILLISECONDS_PER_SECOND)) + WINDOWS_EPOCH_OFFSET_SECONDS;
  seconds -= seconds % TOKEN_WINDOW_SECONDS;
  const ticks = seconds * BigInt(TICKS_PER_SECOND);
  const data = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
  const digest = await crypto.subtle.digest(DIGEST_ALGORITHM, data);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(HEX_RADIX).padStart(HEX_BYTE_LENGTH, "0"))
    .join("")
    .toUpperCase();
}
