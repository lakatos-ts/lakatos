# CLAUDE.md

`@lakatos-ts/lemma`: the Lemma annotation language and its reference implementation. Charter: no engine code, no runtime code (that is `core`), no in-repo dependency; it owns the `typescript` dependency and the typecheck gate because both engines need the gate before discovery.

`src/index.ts` is the only export (`"."` in `package.json`); a name reaches an engine or the CLI by being added there, and the root's `tests/lemma-surface.test.ts` refuses any other route in. `spec/` is the language: change `grammar.ebnf` and `semantics.md` with the parser, and add a fixture under `spec/fixtures/` for every accepted or rejected form (membership is the expectation; `spec/fixtures/README.md` explains the four corpora). `tests/` may reach lemma internals but nothing outside `lemma/`; `tests/helpers/` holds what they share.

Build, typecheck, test, and format from the repo root. This package is a composite `tsc` project the root references, so `npm run build` at the root emits `dist/` here before the engines resolve it; vitest runs it from source through the alias in the root `vitest.config.ts`. A clean rebuild is `rm -rf dist core/dist lemma/dist`.
