import { build, type Plugin } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile } from "svelte/compiler";

const RUNTIME_ENTRY = path.join(import.meta.dirname, "..", "narration-runtime", "runtime.ts");
// The ?raw suffix is Vite's, so the runtime's imports read the same here as they do in the extension
// build; the namespace is esbuild's marker for a resolved path that is not a file to be read normally
// https://vite.dev/guide/assets#importing-asset-as-string
// https://esbuild.github.io/plugins/#namespaces
const RAW_SUFFIX = /\?raw$/;
const RAW_NAMESPACE = "raw";

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

// iife is esbuild's documented format for a bundle that just runs in a browser, which is all an
// inline script can be; es2022 is ours, a floor every browser that can play the page's audio clears
// https://esbuild.github.io/api/#format
// https://esbuild.github.io/api/#target
export async function bundleRuntime() {
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
