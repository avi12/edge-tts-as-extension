// The Node half of a narration host (lib/narration-host.ts), bundled on its own by build-host.ts so an
// app can load it without this repo's toolchain: it lists the voices and records one card at a time
import { fetchVoices, type Voice } from "@/lib/edge-tts/voice-list";
import type { HostRecording } from "@/lib/narration-host";
import { recordClip } from "@/lib/record-clip";
import { setTimeout as sleep } from "node:timers/promises";

// Ours, measured: the gateway turns down about one connection in a few at random, and the next one is
// accepted - a listener waits on this, so a few quick tries beat a long back-off
const RECORD_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

let voicesRequest: Promise<Voice[]> | null = null;

export function listVoices() {
  voicesRequest ??= fetchVoices().catch((error: unknown) => {
    voicesRequest = null;
    throw error;
  });
  return voicesRequest;
}

export async function recordVoice({ text, voice }: {
  text: string;
  voice: string;
}): Promise<HostRecording> {
  const found = (await listVoices()).find(candidate => candidate.ShortName === voice);
  if (!found) {
    throw new Error(`Unknown voice "${voice}"`);
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const { clip } = await recordClip({
        script: text,
        voice: found,
        pinnedVoice: null,
        declaredLanguage: null
      });
      return {
        audio: clip.audio,
        duration: clip.duration,
        words: clip.words
      };
    } catch (error) {
      if (attempt >= RECORD_ATTEMPTS) {
        throw error;
      }

      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}
