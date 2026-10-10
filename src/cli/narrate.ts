// Usage: pnpm narrate <page.html> [--out <file>] [--voice <name>] [--rate <n>] [--export <dir>]
// Synthesizes every data-narrate script in an artifact page with Edge's neural voices and embeds the
// audio, word timings and the narration runtime, so the page narrates itself in any browser.
// --export also writes each clip as mp3 + timings JSON (for timing a Manim video to the voice)

import {
  DEFAULT_PROSODY,
  DEFAULT_VOICE,
  detectLanguage,
  fetchVoices,
  MP3_BITS_PER_SECOND,
  OUTPUT_MIME_TYPES,
  OutputFormat,
  pickVoice,
  RATE_RANGE,
  synthesize,
  type Voice,
  type WordBoundary
} from "@/lib/edge-tts";
import { openEdgeSocket } from "@/lib/edge-tts/node-socket";
import { getErrorMessage } from "@/lib/errors";
import { rateSchema } from "@/lib/message-schemas";
import {
  NARRATION_DATA_ID,
  NarrationAttribute,
  type NarrationClip,
  type NarrationData,
  parseNarrationScript,
  timeNarration
} from "@/lib/narration";
import { z } from "@/lib/zod";
import { build, type Plugin } from "esbuild";
import { parseHTML } from "linkedom";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const RUNTIME_ENTRY = path.join(import.meta.dirname, "..", "narration-runtime", "runtime.ts");
const RAW_SUFFIX = /\?raw$/;
const RAW_NAMESPACE = "raw";
const USAGE = "Usage: pnpm narrate <page.html> [--out <file>] [--voice <name>] [--rate <n>] [--export <dir>]";
// A flag arrives as text, and out of range is a mistake worth stopping for
const rateFlagSchema = z.coerce.number().pipe(rateSchema);
const BLOCK_START = "<!-- narration:start -->";
const BLOCK_END = "<!-- narration:end -->";
const EXISTING_BLOCK = new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}`);
const BITS_PER_BYTE = 8;
const SLUG_LENGTH = 40;
const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const SURROUNDING_DASHES = /^-|-$/g;
const rawTextPlugin: Plugin = {
  name: "raw-text",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: RAW_SUFFIX }, args => ({
      path: path.join(args.resolveDir, args.path.replace(RAW_SUFFIX, "")),
      namespace: RAW_NAMESPACE
    }));
    pluginBuild.onLoad({
      filter: /.*/,
      namespace: RAW_NAMESPACE
    }, async args => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text"
    }));
  }
};

// The same query the runtime runs in the browser, so scripts and clips pair up card by card
function readCards(html: string) {
  const { document } = parseHTML(html);
  return [...document.querySelectorAll(`[${NarrationAttribute.Script}]`)].map(elCard => ({
    script: elCard.getAttribute(NarrationAttribute.Script) ?? "",
    pinnedVoice: elCard.getAttribute(NarrationAttribute.Voice),
    inheritedLocale: elCard.closest("[lang]")?.getAttribute("lang") ?? null,
    cueNames: new Set([...elCard.querySelectorAll(`[${NarrationAttribute.Cue}]`)].map(elCue => elCue.getAttribute(NarrationAttribute.Cue) ?? ""))
  }));
}

type Card = ReturnType<typeof readCards>[number];

function findVoice({ voices, voice }: {
  voices: Voice[];
  voice: string;
}) {
  const found = voices.find(candidate => candidate.ShortName === voice);
  if (!found) {
    throw new Error(`Unknown voice "${voice}" - use a ShortName like ${DEFAULT_VOICE}`);
  }

  return found;
}

// A pinned voice wins; otherwise a non-Latin script names the language, then the nearest lang attribute does
function chooseVoice({ card, voices, defaultVoice }: {
  card: Card;
  voices: Voice[];
  defaultVoice: string;
}) {
  if (card.pinnedVoice) {
    return findVoice({
      voices,
      voice: card.pinnedVoice
    });
  }

  const locale = detectLanguage(parseNarrationScript(card.script).text) ?? card.inheritedLocale;
  return findVoice({
    voices,
    voice: locale ? pickVoice({
      voices,
      locale,
      preferredVoice: defaultVoice
    }) : defaultVoice
  });
}

function checkCard({ script, cueNames, iCard }: Card & { iCard: number }) {
  const { text, cues } = parseNarrationScript(script);
  const label = `Card ${iCard + 1}`;
  if (!text) {
    throw new Error(`${label} has nothing to say - its data-narrate script is empty`);
  }

  const markerNames = new Set(cues.map(cue => cue.name));
  for (const name of markerNames.difference(cueNames)) {
    console.warn(`${label}: [[${name}]] has no data-cue="${name}" element`);
  }

  for (const name of cueNames.difference(markerNames)) {
    console.warn(`${label}: data-cue="${name}" has no [[${name}]] marker`);
  }
}

async function bundleRuntime() {
  const result = await build({
    entryPoints: [RUNTIME_ENTRY],
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    target: "es2022",
    plugins: [rawTextPlugin]
  });
  return result.outputFiles[0]?.text ?? "";
}

async function synthesizeClip({ script, voice, rate }: {
  script: string;
  voice: Voice;
  rate: number;
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
    outputFormat: OutputFormat.Mp3,
    openSocket: openEdgeSocket,
    onAudio: chunk => chunks.push(chunk),
    onWordBoundary: boundary => boundaries.push(boundary)
  });
  const audio = Buffer.concat(chunks);
  const duration = audio.byteLength * BITS_PER_BYTE / MP3_BITS_PER_SECOND;
  const clip: NarrationClip = {
    audio: `data:${OUTPUT_MIME_TYPES[OutputFormat.Mp3]};base64,${audio.toString("base64")}`,
    voice: voice.ShortName,
    locale: voice.Locale,
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

function toSlug(text: string) {
  return text.toLowerCase().replace(NON_SLUG_CHARACTERS, "-").slice(0, SLUG_LENGTH).replace(SURROUNDING_DASHES, "");
}

async function exportClips({ directory, clips }: {
  directory: string;
  clips: Awaited<ReturnType<typeof synthesizeClip>>[];
}) {
  await mkdir(directory, { recursive: true });
  for (const [iClip, { clip, audio }] of clips.entries()) {
    const name = `${String(iClip + 1).padStart(2, "0")}-${toSlug(clip.text)}`;
    const timings = {
      duration: clip.duration,
      text: clip.text,
      words: clip.words,
      cues: clip.cues
    };
    await writeFile(path.join(directory, `${name}.mp3`), audio);
    await writeFile(path.join(directory, `${name}.json`), JSON.stringify(timings, null, 2));
  }
}

function embedNarration({ html, data, runtime }: {
  html: string;
  data: NarrationData;
  runtime: string;
}) {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  const block = [
    BLOCK_START,
    `<script type="application/json" id="${NARRATION_DATA_ID}">${json}</script>`,
    `<script>${runtime.replaceAll("</script", "<\\/script")}</script>`,
    BLOCK_END
  ].join("\n");
  return `${html.replace(EXISTING_BLOCK, "").trimEnd()}\n${block}\n`;
}

// pnpm --dir runs scripts in the repo, INIT_CWD is where the caller ran it
function resolveFromCaller(file: string) {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: {
        type: "string"
      },
      voice: {
        type: "string",
        default: DEFAULT_VOICE
      },
      rate: {
        type: "string",
        default: String(DEFAULT_PROSODY.rate)
      },
      export: {
        type: "string"
      }
    }
  });
  const [inputArgument] = positionals;
  if (!inputArgument) {
    throw new Error(USAGE);
  }

  const parsedRate = rateFlagSchema.safeParse(values.rate);
  if (!parsedRate.success) {
    throw new Error(`--rate takes a speed multiplier from ${RATE_RANGE.min} to ${RATE_RANGE.max}, got "${values.rate}"`);
  }

  const voices = await fetchVoices();
  findVoice({
    voices,
    voice: values.voice
  });

  const input = resolveFromCaller(inputArgument);

  const html = await readFile(input, "utf8");
  const cards = readCards(html);
  if (cards.length === 0) {
    throw new Error(`No data-narrate scripts in ${input}`);
  }

  for (const [iCard, card] of cards.entries()) {
    checkCard({
      ...card,
      iCard
    });
  }

  const clips: Awaited<ReturnType<typeof synthesizeClip>>[] = [];
  for (const [iCard, card] of cards.entries()) {
    const synthesized = await synthesizeClip({
      script: card.script,
      voice: chooseVoice({
        card,
        voices,
        defaultVoice: values.voice
      }),
      rate: parsedRate.data
    });
    clips.push(synthesized);
    console.log(`${iCard + 1}/${cards.length}  ${synthesized.clip.duration.toFixed(1)}s  ${synthesized.clip.voice}  cues: ${synthesized.clip.cues.map(([name, time]) => `${name}@${time}`).join(" ") || "-"}`);
  }

  if (values.export) {
    await exportClips({
      directory: resolveFromCaller(values.export),
      clips
    });
  }

  const output = values.out ? resolveFromCaller(values.out) : input;
  await writeFile(
    output, embedNarration({
      html,
      data: {
        clips: clips.map(({ clip }) => clip)
      },
      runtime: await bundleRuntime()
    })
  );
  let totalSeconds = 0;
  for (const { clip } of clips) {
    totalSeconds += clip.duration;
  }

  console.log(`Narrated ${clips.length} parts (${totalSeconds.toFixed(0)}s of audio) into ${output}`);
}

await main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
