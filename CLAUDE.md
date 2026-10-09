# CLAUDE.md

Monorepo for lakatos: proofs and refutations for TypeScript. `README.md` (Layout, Architecture) is the tour; each package's own `CLAUDE.md` loads when you work under it.

Start from the bins — `pabst/src/cli.ts` (refute), `thales/frontend/src/cli.ts` (prove), `thales/frontend/src/exe-cli.ts` (`thales-exe`, one file on the tarski evaluator) — and `core/src/envelope.ts` + `core/src/szs.ts` (the per-annotation output contract, schema in `core/schemas/`).

## Layering

`thales/` (`@lakatos/thales`: proofs, Lean; its own `thales` bin) and `pabst/` (`@lakatos/pabst`: refutations, fast-check; its own `pabst` bin) never depend on each other. Both may depend on `core/` (`@lakatos/core`: the shared runtime — envelope, SZS statuses, interrupt handling, run directories; depends on nothing in the repo), `lemma/` (`@lakatos/lemma`: the Lemma annotation language — discovery, `@ensures` extraction, parsing, the typecheck gate; its spec and conformance corpus in `lemma/spec/`) and `tarski/` (`@lakatos/tarski`: the shared JS semantics — the Lean package thales proves against, and the TypeScript bridge, evaluator runner, and `tarski-test262` bin over it; see its `CLAUDE.md`), which depend on no engine. The root is a private npm workspace root with no sources of its own: it drives build, test, format, and CI, and `tests/` holds only the repository-wide checks (layering, the Lemma surface, the trust section, prove-and-refute parity), which may import any package by relative path. `core/`, `lemma/`, `pabst/`, `tarski/`, and `thales/` are its workspace packages.

## Building and testing

Every TypeScript part — `core/`, `lemma/`, `pabst/`, `tarski/frontend/`, `thales/frontend/` — builds, typechecks, tests, and formats from the repo root (`tsc -b` builds `core/` first; vitest runs core from source through an alias, the built bins resolve it through the workspace link). Lean lives in two lake packages: `tarski/` (the semantics library, toolchain pin, tracked manifest) and `thales/` (the prover, which requires `tarski` by path). Run `lake` from the package you are building; building thales builds tarski. `thales` and `thales-exe` need a lakatos checkout with the Lean toolchain; the prove e2e and verdict corpus run only under `LAKATOS_PROVE_E2E=1` (CI: `thales.yml`; `tarski.yml` builds the semantics package and runs its Lean tests; `lakatos.yml` covers the TypeScript suites, typecheck, format, and a coverage gate).

## Issue tracker

GitHub Issues on `lakatos-ts/lakatos` is the tracker: bugs, features, triage, and everything a PR or design record refers to by number. Conventions: `thales/docs/agents/issue-tracker.md`; triage labels: `thales/docs/agents/triage-labels.md`.

## Docs

Design records spanning more than one component go in `docs/design/`; a single engine's notes stay under that engine (`thales/docs/`). Records are dated and are not updated to track the code.

## Task tracking

Beads (`bd`) is paused as of 2026-10-09. Do not run `bd`, pour molecules, or follow the `bd prime` hook output; the `.beads/` data and formulas, `scripts/bd-*`, and `scripts/prompts/` stay in place so the loop can be brought back. Track a session's steps in the conversation; anything that outlives the session is a GitHub issue.

At session end: file GitHub issues for follow-up work, run the local gate if code changed, and report changed files and status before any commit or push.
