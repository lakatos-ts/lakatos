# CLAUDE.md

Monorepo for lakatos: proofs and refutations for TypeScript. `README.md` (Layout, Architecture) is the tour; each package's own `CLAUDE.md` loads when you work under it.

Start from the bins — `pabst/src/cli.ts` (refute), `thales/Thales/Main.lean` (prove, `lake build thales`), `thales/Tarski/Main.lean` (`tarski <file.ts>`, one file on the tarski evaluator, reaching lemma through `thales/Tarski/Lemma.lean`), `thales/Tarski/Test262/Main.lean` (`tarski-test262`, test262 against the evaluator) — and `pabst/src/envelope.ts` + `pabst/src/szs.ts` (the per-annotation output contract, whose JSON Schema is `spec/envelope.schema.json`).

## Layering

`thales/` (one lake package, no npm package: the JS semantics — `Js/`, the library proofs are stated against, and `Tarski/`, the evaluator, with the `tarski` executable over it and the `tarski-test262` runner — beside the prover, `ThalesDsl/`, `ThalesEmit/`, and `Thales/`, the `thales` executable; all three executables reach lemma as a subprocess through `Tarski/Lemma.lean`, and `scripts/check-imports.sh` keeps `Js/` and `Tarski/` from importing the prover; see its `CLAUDE.md`) and `pabst/` (`@lakatos/pabst`: refutations, fast-check, and the runtime its bin runs on — envelope, SZS statuses, interrupt handling, run directories; its own `pabst` bin) never depend on each other. Both may depend on `lemma/` (`@lakatos/lemma`: the Lemma annotation language and the TypeScript front end — discovery, `@ensures` extraction, parsing, the typecheck gate, the parser bridge to ESTree, thales's emitter, and the `lemma` bin that prints a checked-program document per file, whose v1 carries the emitter's output and each annotation's outcome; its spec and conformance corpus in `lemma/spec/`), which depend on no engine. The root is a private npm workspace root with no sources of its own: it drives build, test, format, and CI; `tests/` holds only the CI scope script's suite. `lemma/` and `pabst/` are its workspace packages; thales's vitest suites and check scripts (`npm run check:envelopes`, `npm run check:verdict-channel`) run from the root too.

## Building and testing

Every TypeScript part — `lemma/`, `pabst/` — builds, typechecks, tests, and formats from the repo root (`tsc -b` builds `lemma/` first; vitest runs lemma from source through an alias, the built bins resolve it through the workspace link). Lean lives in one lake package, `thales/` (toolchain pin, tracked manifest); run `lake` there, where `lake build` builds every library and all three executables and `lake build Test` every Lean test. `thales`, `tarski <file.ts>`, and `tarski-test262` need a lakatos checkout with the Lean toolchain (all three reach the checkout's lemma through `LAKATOS_LEMMA=<abs path to lemma/>` until lemma 0.2.0 is published); the prove e2e and verdict corpus run only under `LAKATOS_PROVE_E2E=1` (CI: `lean.yml`, which also runs the Lean tests, the test262 slice, and both boundary checks; `lakatos.yml` covers the TypeScript suites, typecheck, format, and a coverage gate).

## Issue tracker

GitHub Issues on `lakatos-ts/lakatos` is the tracker: bugs, features, triage, and everything a PR or design record refers to by number. Conventions: `thales/docs/agents/issue-tracker.md`; triage labels: `thales/docs/agents/triage-labels.md`.

## Docs

Design records spanning more than one component go in `docs/design/`; a single engine's notes stay under that engine (`thales/docs/`). Records are dated and are not updated to track the code.

## Task tracking

Beads (`bd`) is paused as of 2026-10-09. Do not run `bd`, pour molecules, or follow the `bd prime` hook output; the `.beads/` data and formulas, `scripts/bd-*`, and `scripts/prompts/` stay in place so the loop can be brought back. Track a session's steps in the conversation; anything that outlives the session is a GitHub issue.

At session end: file GitHub issues for follow-up work, run the local gate if code changed, and report changed files and status before any commit or push.
