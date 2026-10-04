import { TICKS_PER_SECOND, TRUSTED_CLIENT_TOKEN } from "./constants";

const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600n;
const TOKEN_WINDOW_SECONDS = 300n;
const MILLISECONDS_PER_SECOND = 1000;
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
