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
  getDeclaredLanguage,
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
import { compile } from "svelte/compiler";

const RUNTIME_ENTRY = path.join(import.meta.dirname, "..", "narration-runtime", "runtime.ts");
// The ?raw suffix is Vite's, so the runtime's imports read the same here as they do in the extension
// build; the namespace is esbuild's marker for a resolved path that is not a file to be read normally
// https://vite.dev/guide/assets#importing-asset-as-string
// https://esbuild.github.io/plugins/#namespaces
const RAW_SUFFIX = /\?raw$/;
const RAW_NAMESPACE = "raw";
const USAGE = "Usage: pnpm narrate <page.html> [--out <file>] [--voice <name>] [--rate <n>] [--export <dir>]";
// A flag arrives as text, and out of range is a mistake worth stopping for
const rateFlagSchema = z.coerce.number().pipe(rateSchema);
// Ours: markers that are invisible in the page and let a re-run replace exactly what the last run
// wrote, which is what makes narrating twice idempotent
const BLOCK_START = "<!-- narration:start -->";
const BLOCK_END = "<!-- narration:end -->";
const EXISTING_BLOCK = new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}`);
// A byte is eight bits - half of the duration estimate in synthesizeClip, the other half being the
// format's own bit rate
const BITS_PER_BYTE = 8;
// Ours: enough of the first spoken words to tell the exported clips apart in a Manim script, with
// everything that is not a plain lower-case word character folded away so the name is a safe file name
const SLUG_LENGTH = 40;
const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const SURROUNDING_DASHES = /^-|-$/g;
// The runtime's UI is Svelte, and a page gets it compiled rather than compiling anything itself. The
// components carry no styles, so nothing needs the css output - each shadow root adopts its own sheet
// https://svelte.dev/docs/svelte/svelte-compiler#compile
const svelteComponentPlugin: Plugin = {
  name: "svelte-component",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.svelte$/ }, async args => ({
      contents: compile(await readFile(args.path, "utf8"), {
        filename: args.path,
        generate: "client",
        css: "external"
      }).js.code,
      loader: "js"
    }));
  }
};

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
  const rootLanguage = document.documentElement?.getAttribute("lang") ?? null;
  return [...document.querySelectorAll(`[${NarrationAttribute.Script}]`)].map(elCard => ({
    script: elCard.getAttribute(NarrationAttribute.Script) ?? "",
    pinnedVoice: elCard.getAttribute(NarrationAttribute.Voice),
    cardLanguage: elCard.closest("[lang]")?.getAttribute("lang") ?? null,
    rootLanguage,
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

// A pinned voice wins; otherwise a non-Latin script names the language, then the nearest lang attribute
// does. What the card asked for travels with the clip, so a live voice can answer the same way
function chooseVoice({ card, voices, defaultVoice }: {
  card: Card;
  voices: Voice[];
  defaultVoice: string;
}) {
  if (card.pinnedVoice) {
    return {
      voice: findVoice({
        voices,
        voice: card.pinnedVoice
      }),
      pinnedVoice: card.pinnedVoice,
      declaredLanguage: null
    };
  }

  const { text } = parseNarrationScript(card.script);
  // The recording follows the page's own language too; only what a card says for itself travels on
  const recordedLanguage = detectLanguage(text) ?? card.cardLanguage;
  return {
    voice: findVoice({
      voices,
      voice: recordedLanguage ? pickVoice({
        voices,
        locale: recordedLanguage,
        preferredVoice: defaultVoice
      }) : defaultVoice
    }),
    pinnedVoice: null,
    declaredLanguage: getDeclaredLanguage({
      text,
      cardLanguage: card.cardLanguage,
      rootLanguage: card.rootLanguage
    })
  };
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

// iife is esbuild's documented format for a bundle that just runs in a browser, which is all an
// inline script can be; es2022 is ours, a floor every browser that can play the page's audio clears
// https://esbuild.github.io/api/#format
// https://esbuild.github.io/api/#target
async function bundleRuntime() {
  const result = await build({
    entryPoints: [RUNTIME_ENTRY],
    bundle: true,
    format: "iife",
    minify: true,
    write: false,
    target: "es2022",
    plugins: [rawTextPlugin, svelteComponentPlugin]
  });
  return result.outputFiles[0]?.text ?? "";
}

async function synthesizeClip({ script, voice, pinnedVoice, declaredLanguage, rate }: {
  script: string;
  voice: Voice;
  pinnedVoice: string | null;
  declaredLanguage: string | null;
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
  // The format asked for above is a constant bit rate mp3 (its name states the rate), so the length
  // of the audio is bytes over that rate - no decoding, and it matches what the browser reports
  // https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech#audio-outputs
  const duration = audio.byteLength * BITS_PER_BYTE / MP3_BITS_PER_SECOND;
  const clip: NarrationClip = {
    // The clip rides inside the page as a base64 data url, the form RFC 2397 defines, so a narrated
    // page needs no second request and survives being copied anywhere
    // https://www.rfc-editor.org/rfc/rfc2397
    audio: `data:${OUTPUT_MIME_TYPES[OutputFormat.Mp3]};base64,${audio.toString("base64")}`,
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

// A script element whose type is not a JavaScript one is a data block: the browser parses it as text
// and hands it over instead of running it. Both escapes are the spec's restriction on what may sit
// inside a script element, where a literal "</script" or "<!--" would close it early
// https://html.spec.whatwg.org/multipage/scripting.html#data-block
// https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements
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
      rate: parsedRate.data,
      ...chooseVoice({
        card,
        voices,
        defaultVoice: values.voice
      })
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
