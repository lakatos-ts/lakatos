# CLAUDE.md

Monorepo for lakatos: proofs and refutations for TypeScript. `README.md` (Layout, Architecture) is the tour; each package's own `CLAUDE.md` loads when you work under it.

Start from the bins — `pabst/src/cli.ts` (refute), `thales/Thales/Main.lean` (prove, `lake build thales`), `tarski/Tarski/Main.lean` (`tarski <file.ts>`, one file on the tarski evaluator, reaching lemma through `tarski/Tarski/Lemma.lean`), `tarski/Tarski/Test262/Main.lean` (`tarski-test262`, test262 against the evaluator) — and `core/src/envelope.ts` + `core/src/szs.ts` (the per-annotation output contract, whose JSON Schema is `spec/envelope.schema.json`).

## Layering

`thales/` (proofs: a Lean executable, `thales`, no npm package; it reaches lemma as a subprocess and requires tarski by path) and `pabst/` (`@lakatos/pabst`: refutations, fast-check; its own `pabst` bin) never depend on each other. Both may depend on `core/` (`@lakatos/core`: the shared runtime — envelope, SZS statuses, interrupt handling, run directories; depends on nothing in the repo), `lemma/` (`@lakatos/lemma`: the Lemma annotation language and the TypeScript front end — discovery, `@ensures` extraction, parsing, the typecheck gate, the parser bridge to ESTree, thales's emitter, and the `lemma` bin that prints a checked-program document per file, whose v1 carries the emitter's output and each annotation's outcome; its spec and conformance corpus in `lemma/spec/`) and `tarski/` (the shared JS semantics, no npm package — the Lean package thales proves against, the evaluator and the `tarski` executable over it, which reaches lemma as a subprocess (`Tarski/Lemma.lean`), and the `tarski-test262` executable, which runs test262 through lemma and the `tarski` binary; see its `CLAUDE.md`), which depend on no engine. The root is a private npm workspace root with no sources of its own: it drives build, test, format, and CI, and `tests/` holds only the repository-wide checks (layering, the Lemma surface, the trust section, prove-and-refute parity, the emission corpus pin in `tests/emission-corpus.test.ts`), which may import any package by relative path. `core/`, `lemma/`, and `pabst/` are its workspace packages; thales's vitest suites and check scripts (`npm run check:envelopes`, `npm run check:verdict-channel`) run from the root too.

## Building and testing

Every TypeScript part — `core/`, `lemma/`, `pabst/` — builds, typechecks, tests, and formats from the repo root (`tsc -b` builds `core/` first; vitest runs core from source through an alias, the built bins resolve it through the workspace link). Lean lives in two lake packages: `tarski/` (the semantics library, toolchain pin, tracked manifest) and `thales/` (the prover, which requires `tarski` by path). Run `lake` from the package you are building; building thales builds tarski. `thales`, `tarski <file.ts>`, and `tarski-test262` need a lakatos checkout with the Lean toolchain (both reach the checkout's lemma through `LAKATOS_LEMMA=<abs path to lemma/>` until lemma 0.2.0 is published); the prove e2e and verdict corpus run only under `LAKATOS_PROVE_E2E=1` (CI: `thales.yml`; `tarski.yml` builds the semantics package and runs its Lean tests; `lakatos.yml` covers the TypeScript suites, typecheck, format, and a coverage gate).

## Issue tracker

GitHub Issues on `lakatos-ts/lakatos` is the tracker: bugs, features, triage, and everything a PR or design record refers to by number. Conventions: `thales/docs/agents/issue-tracker.md`; triage labels: `thales/docs/agents/triage-labels.md`.

## Docs

Design records spanning more than one component go in `docs/design/`; a single engine's notes stay under that engine (`thales/docs/`). Records are dated and are not updated to track the code.

## Task tracking

Beads (`bd`) is paused as of 2026-10-09. Do not run `bd`, pour molecules, or follow the `bd prime` hook output; the `.beads/` data and formulas, `scripts/bd-*`, and `scripts/prompts/` stay in place so the loop can be brought back. Track a session's steps in the conversation; anything that outlives the session is a GitHub issue.

At session end: file GitHub issues for follow-up work, run the local gate if code changed, and report changed files and status before any commit or push.
