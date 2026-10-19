# CLAUDE.md

The lakatos umbrella: proofs and refutations for TypeScript. The tools live in their own repositories under `lakatos-ts` — [lemma](https://github.com/lakatos-ts/lemma) (the Lemma language and the TypeScript front end, `@lakatos/lemma`), [pabst](https://github.com/lakatos-ts/pabst) (refutation, `@lakatos/pabst`), and [thales](https://github.com/lakatos-ts/thales) (proof, and tarski, the JavaScript semantics; Lean) — each with its own `CLAUDE.md`, CI, and issue tracker. `README.md` is the tour.

This repository holds no tool's code: `spec/envelope.schema.json` (the per-annotation output contract every engine honors; pabst carries a copy, and nothing checks the two agree), the design records in `docs/design/` (dated, not updated to track the code; records spanning more than one tool go here), and `scripts/sync`, which clones or fast-forwards this repository and the three tool repositories beside it. Its only check is formatting: `npm ci && npm run format:check`.

## Issue tracker

GitHub Issues: a tool's issues go on its own repository; cross-tool issues stay on `lakatos-ts/lakatos`. The triage conventions are in each tool repository's `docs/agents/`.

## Task tracking

Beads (`bd`) is paused as of 2026-10-09. Do not run `bd`, pour molecules, or follow the `bd prime` hook output; the `.beads/` data and formulas, `scripts/bd-*`, and `scripts/prompts/` stay in place so the loop can be brought back. Track a session's steps in the conversation; anything that outlives the session is a GitHub issue.
