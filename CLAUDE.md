# Stack
- pnpm
- WXT extension framework (Chrome MV3)
- TypeScript everywhere (100% type safety, let TypeScript infer return types - never write them explicitly). The popup is Svelte 5 with runes (`@wxt-dev/module-svelte`): presentational components in `src/entrypoints/popup/components/`, popup state and actions in `popup-state.svelte.ts`, message plumbing in `src/lib`. Everything else is framework-free - the narration runtime above all, it ships inside every artifact
- The popup wears the cyberpunk skin: `src/styles/cyberpunk.css` is a vendored copy of `~/.claude/artifact-cyberpunk.css` (the source of truth - re-copy, never edit tokens here), fonts come bundled from `@fontsource` (`src/styles/fonts.css`), and `popup/style.css` `@import`s both so the cascade order lives in CSS. Build on its tokens and classes; never hardcode a color that has a token
- TypeScript 7 (`@typescript/native` alias, gives `tsc`) side by side with TypeScript 6 (`typescript` alias of `@typescript/typescript6`, gives `tsc6`) - typescript-eslint still needs the TS 6 API; never collapse them back into one
- All messaging goes through `@webext-core/messaging` (WXT's own recommendation) - never `browser.runtime.sendMessage`, `onMessage` or ports by hand. Two protocol maps, each keyed by an enum so no message type is ever a bare string: `src/lib/messages.ts` is the extension bus (`defineExtensionMessaging`, popup/bridge -> background -> offscreen player), `src/lib/narration-bridge.ts` the page bus (`defineCustomEventMessaging`, a narrated page <-> the bridge content script). The message type is the routing, so the background's and the player's keys stay distinct. The one exception is `browser.runtime.onMessageExternal`, which the library does not cover - other extensions keep the documented plain-object API, zod-validated on arrival
- zod for validating loose data
- vitest for tests (`LIVE=1 pnpm test` also hits the real Read Aloud service)
- Layout: `src/lib/edge-tts/*` is the Read Aloud protocol client, `src/lib/messages.ts` the message contract, `src/lib/settings.ts` the stored settings, `src/entrypoints/*` the extension's background, offscreen player and popup. `src/cli/narrate.ts` is the Node CLI that pre-renders page narration (run through `tsx`), and `src/cli/render-icons.ts` (`pnpm icons`) renders `src/icon/*.svg` into the manifest PNGs in `src/public/icon/` and the 300 px store logo in `store/`. `src/cli/release.ts` (`pnpm release`) builds, zips, signs a `.crx` with `keys/chrome.pem` (gitignored - generate it once with `openssl genrsa`) and creates the GitHub release with both attached. `src/cli/dev.ts` (`pnpm dev:edge`) is the dev loop: it builds, opens ONE isolated browser (`.dev-profile`, Edge by default, `--browser` for another Chromium, `--url` for the page to open) and then rebuilds and reloads the extension and its injected pages in place on every save - never relaunch the browser to pick a change up, and never close one you did not open. Only manifest changes (`wxt.config.ts`) need a fresh launch, which it says in the log. `src/narration-runtime/` is the runtime narrate bundles (esbuild) into every narrated page - keep that runtime free of zod and other heavy imports, it ships inside each artifact. `src/lib/edge-tts/node-socket.ts` is Node-only (undici headers) and stays out of the `@/lib/edge-tts` index. `src/public/` holds static files copied as-is (WXT `srcDir: "src"`, `publicDir: "src/public"`). `research/*.mjs` are Node scripts from the reverse engineering. `research/edge-microsoft-voices/*.js` is vendored Microsoft source - never lint, refactor or edit it

The user's global rules (SSOT/DRY, pure CSS over JavaScript, digestible commits on `main`) apply here too.

# Code style
- Use the `browser` namespace
- Use early returns for readability and maintainability
- Use functional programming
- Use async/await whenever possible. Never `void` a promise to drop it: `await` it, making the enclosing callback `async` if that is what it takes, and widening a callback type to `=> Promise<void>` where the awaiting has to happen at the real boundary. Ordering that must stay synchronous is not an excuse to drop a promise, only to move it: an MV3 background registers every listener first and awaits afterwards. There are exactly two places a `void` is allowed, each carrying a comment saying which: a message that nothing may ever answer (`defineCustomEventMessaging` has no timeout, so a notification sent to a page with no narration runtime never settles - awaiting one would stall every other frame behind it), and a promise that resolves only when the whole job ends while the caller owes an answer about its start (the player's `speak`)
- Use DRY with separation of concerns, prioritizing readability
- Minimize indentations
- Use `for-of` instead of `.forEach`, and a plain `for` loop instead of `.reduce()`
- Use modern browser and CSS features
- Prefer semantic HTML elements (`button`, `nav`, `ul`/`li`, `section`, `header`, `footer`, `dialog`, `menu`, `output`, etc.) over `div`/`span` with a `role`; only add ARIA (`role`, `aria-*`) when no native element carries the semantics or state, and never add ARIA that merely restates what the element already means
- Avoid `window.` prefixes unless it increases readability
- Avoid `setTimeout` unless absolutely necessary
- Avoid comments unless absolutely necessary - prefer descriptive names; default to zero comments and rename variables/functions until they read like the comment would. Facts recovered by reverse engineering (where a value came from, why the server needs it) are the exception - keep those, short
- Don't use em dashes - use regular hyphens
- If a callback arrow function has a typed param, don't annotate the type explicitly
- In Svelte markup, a content tag never holds a ternary (`{isOn ? "on" : "off"}`) - use an `{#if}`/`{:else}` block, or a `$derived.by` with if/else for a value. A ternary inside an attribute or directive value is fine
- No blank line right after an opening tag or right before a closing one, `<script>` and `<style>` included
- Functions with 2+ params take a single destructured object param (`f({ a, b }: {...})`) so every argument is self-documenting at the call site. Reuse an existing/built-in type when one fits the object shape; only inline the object type when nothing fits - never invent a named type just to convert. EXEMPT (stay positional): key/value-style accessors where the first arg is a key/identifier and the second its value/operation/options, and runtime-positional signatures the caller controls (HOF callbacks `.map`/`.filter`/`.sort`/`.forEach`/`addEventListener`, Promise executors, event handlers with first param `e`, `browser.*` listener callbacks, external-library-dictated signatures)
- Avoid nested try/catch - flatten with early returns or extracted functions
- Validate loose data with zod, not hand-rolled checks: any multi-clause shape/range/format validation (typeof chains, `"x" in obj` guards, `Number.isFinite` + bounds combos, ad-hoc regex format tests on external/storage/message payloads) becomes a module-level zod schema + `safeParse`. Bounds come from the existing `SCREAMING_SNAKE_CASE` constants via `.min()`/`.max()`; reuse an existing schema before authoring one; a schema consumed only for its inferred type stays un-exported. Import `z` from `@/lib/zod` (jitless wrapper - MV3's extension CSP blocks the `new Function` probe zod runs otherwise). NOT zod material: single trivial checks, TS union narrowing of already-typed values, hot-loop arithmetic guards
- `safeParse` results take exactly two forms, chosen by what is consumed. Validity only: collapse immediately - `schema.safeParse(x).success` inline in the condition or into an `is`-prefixed boolean; never store the result object just to read `.success`. `.data`/`.error` consumed: store the result as `parsed` (`parsed<Subject>` when one scope holds several parses) and guard with `parsed.success`
- Inline one-off variables (assigned once, used once) when it stays readable - but NOT when the variable names a magic number/string or documents an otherwise opaque expression
- Extract an `if`/ternary/guard condition into a descriptive `is`-prefixed boolean variable rather than inlining the raw expression into the condition - the named boolean reads as the documentation
- Apply parallel modifications whenever possible
- Always prefer the `@/` path alias over parent-relative (`../`) imports. Same-directory `./foo` stays relative

# Naming conventions
- Variables and functions: `camelCase`, full words (no abbreviations)
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Exception: event handler first parameter is always `e`

## Variable prefixes
- Element: `el` prefix (e.g. `elButton`)
- Index: `i` prefix (e.g. `iItem`), or bare `i` when iterating in a for loop/higher-order function
- Boolean: `is` prefix (e.g. `isLoading`), phrased positively (e.g. `isEnabled`, not `isDisabled` or `isNotEnabled`)

# Hardcoded values
- Strings: use enums; if no enum fits, use a descriptive `SCREAMING_SNAKE_CASE` constant
- Numbers: use a descriptive `SCREAMING_SNAKE_CASE` constant

# CSS
- Use native CSS nesting - nest child and state selectors under their parent (`&:hover`, a nested `.child`) instead of repeating the parent in flat sibling rules
- Always respect `prefers-reduced-motion` - never ship an ungated transition/animation; add a `@media (prefers-reduced-motion: reduce)` override that removes the motion (smooth scrolling included)
- Never the `transform` shorthand - use the individual `translate`/`rotate`/`scale` properties
- Never hand-write vendor prefixes (`-webkit-` etc.)

# Storage
- Don't automatically persist to storage - rely on fallback values; only store what the user explicitly set (or a cache that saves a network round trip)
- Use WXT's storage API (`storage.defineItem` / `storage.getItem("local:KEY")`), not `browser.storage.local.*`
- Only use the `local:` or `sync:` storage areas - never `session:`

# UI copy
- No full stops at end of messages
- Informal tone

# Linting
After each modification, run the checks (`pnpm check` runs all of them in order):
- `pnpm compile` - `tsc --noEmit`
- `pnpm svelte:check` - `svelte-check`, type-checks `.svelte` files (tsc does not see them)
- `pnpm lint` runs `oxlint --type-aware --fix && eslint --fix` (then a final plain oxlint as the gate) - oxlint owns the logic and type-aware rules (`.oxlintrc.json`, with `oxlint-tsgolint`), ESLint owns the stylistic ones (`eslint.config.js` + local rules in `eslint-rules/`); always run with `--fix`. oxlint does not inherit `ignorePatterns` through `extends`, so `.oxlintrc.fix.json` repeats the list - keep the two in sync
- `pnpm stylelint` runs `stylelint "**/*.{css,svelte}" --fix` (`stylelint.config.mjs`, the youtube-time-manager config: postcss-html lints `<style>` in `.svelte`)
- `pnpm test`
- After every bug fix, feature, or refactor - anything that removes or rewires code - run a fallow dead-code audit and clean up what it flags as newly unused (imports, helpers, exports, whole files) so changes never leave orphans behind. Never run `fallow fix` automatically - act on the audit by hand
  - ONE root config at `/.fallowrc.json`. It carries only `health` thresholds, the `research/*.mjs` entries, two fixed ignores (the vendored `research/edge-microsoft-voices/**`, and `@typescript/native`, whose `tsc` bin fallow attributes to `typescript`) and `unused-enum-members: warn` (enums double as zod value vocabularies via `z.enum(SomeEnum)`, so not every member is referenced by name). Always run it as `pnpm fallow` (= `fallow audit --base HEAD`), which `pnpm check` chains - never `fallow dead-code`, whose full sweep reports the whole repo's inherited findings instead of what this change left behind
  - fallow is PINNED to 2.103.0 (devDep). Never invoke it via `pnpx`/`pnpm dlx` (that fetches latest and ignores the pin) - always the local bin (`pnpm fallow` / `pnpm exec fallow`)
  - An export used only WITHIN its own file is an over-export: drop the `export` keyword rather than adding an ignore - never grow the ignore lists
- Lint coverage: `src/**` (any new entrypoint, e.g. a content script, is covered automatically), `research/*.mjs` (Node globals), `eslint-rules/`, configs. Excluded: `research/edge-microsoft-voices/`, `.output/`, `.wxt/`
- Never blanket-disable a rule; a narrowly justified disable comment is acceptable only when a rule truly cannot be satisfied
