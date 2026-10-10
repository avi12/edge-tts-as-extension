# Contributing

Issues and pull requests are welcome.

## Running it

```sh
pnpm install
pnpm dev:edge       # builds, opens one isolated browser, reloads the extension in place on every save
pnpm check          # compile, svelte-check, lint, stylelint, dead-code audit, tests - about 13 seconds
```

`pnpm check` has to pass before a pull request. `LIVE=1 pnpm test` additionally hits the real Read Aloud
service, which is worth running when you touch anything under `src/lib/edge-tts/`.

## House rules

[CLAUDE.md](CLAUDE.md) is the style guide this codebase actually follows - it is written for an AI
assistant, but every rule in it applies to a human patch too. The short version:

- TypeScript everywhere, no type assertions, inferred return types
- Early returns, functional style, no nested try/catch, `for-of` over `.forEach`
- Named constants instead of literals, and **every constant says where its value comes from** - a link to
  the document that defines it, the Edge file it was recovered from, or a plain note that the choice is
  ours. A new magic number without its origin will be asked about in review
- Validate anything loose with zod, never hand-rolled checks
- Commits are one self-contained change each, with a message that says what and why

## The service

Microsoft can change the endpoint or its checks at any time. If synthesis breaks, `node research/probe.mjs`
re-runs the whole handshake sweep and `research/README.md` records what each check was last measured to be -
update that file in the same pull request as the fix.
