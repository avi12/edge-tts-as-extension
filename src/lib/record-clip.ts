import {
  DEFAULT_PROSODY,
  MP3_BITS_PER_SECOND,
  OUTPUT_MIME_TYPES,
  OutputFormat,
  synthesize,
  type Voice,
  type WordBoundary
} from "@/lib/edge-tts";
import { openEdgeSocket } from "@/lib/edge-tts/node-socket";
import { type NarrationClip, parseNarrationScript, timeNarration } from "@/lib/narration";

// A byte is eight bits - half of the duration estimate in recordClip, the other half being the
// format's own bit rate
const BITS_PER_BYTE = 8;

// Node only: the narrate CLI records every card of a page with it, and a page's host records one card
// in the voice its listener picked
export async function recordClip({ script, voice, pinnedVoice, declaredLanguage, rate = DEFAULT_PROSODY.rate }: {
  script: string;
  voice: Voice;
  pinnedVoice: string | null;
  declaredLanguage: string | null;
  rate?: number;
}) {
  const { text, cues } = parseNarrationScript(script);
  const chunks: Uint8Array[] = [];
  const boundaries: WordBoundary[] = [];
  await synthesize({
    text,
    voice: voice.ShortName,
    prosody: {
      ...DEFAULT_PROSODY,
      rate
    },
    outputFormat: OutputFormat.MP3,
    openSocket: openEdgeSocket,
    onAudio: chunk => chunks.push(chunk),
    onWordBoundary: boundary => boundaries.push(boundary)
  });
  const audio = Buffer.concat(chunks);
  // The format asked for above is a constant bit rate mp3 (its name states the rate), so the length
  // of the audio is bytes over that rate - no decoding, and it matches what the browser reports
  // https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
  const duration = audio.byteLength * BITS_PER_BYTE / MP3_BITS_PER_SECOND;
  const clip: NarrationClip = {
    // The clip rides inside the page as a base64 data url, the form RFC 2397 defines, so a narrated
    // page needs no second request and survives being copied anywhere
    // https://www.rfc-editor.org/rfc/rfc2397
    audio: `data:${OUTPUT_MIME_TYPES[OutputFormat.MP3]};base64,${audio.toString("base64")}`,
    voice: voice.ShortName,
    locale: voice.Locale,
    pinnedVoice,
    declaredLanguage,
    duration,
    text,
    ...timeNarration({
      text,
      cues,
      boundaries,
      duration
    })
  };
  return {
    clip,
    audio
  };
}
