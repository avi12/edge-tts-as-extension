import { TRUSTED_CLIENT_TOKEN } from './constants';

/** Seconds between the Windows file-time epoch (1601-01-01) and the Unix epoch. */
const WIN_EPOCH_OFFSET_S = 11_644_473_600n;
/** The token rotates every 5 minutes. */
const WINDOW_S = 300n;

/**
 * The "Sec-MS-GEC" value Edge's native code attaches to Read Aloud requests:
 * SHA-256 of (Windows file time rounded down to 5 minutes, in 100 ns ticks)
 * followed by the trusted client token, as upper-case hex.
 */
export async function secMsGec(nowMs = Date.now()): Promise<string> {
  let seconds = BigInt(Math.floor(nowMs / 1000)) + WIN_EPOCH_OFFSET_S;
  seconds -= seconds % WINDOW_S;
  const ticks = seconds * 10_000_000n;
  const data = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
