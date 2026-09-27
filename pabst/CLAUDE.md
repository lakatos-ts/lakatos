# CLAUDE.md

Pabst is the lakatos refutation tool: `@ensures` annotations become fast-check property tests, generated into the target project's per-run directory and executed with vitest; failures come back as per-annotation issues mapped to SZS statuses (`falsified` → CounterSatisfiable, `threw` → Error, `exhausted` → GaveUp, `budget` → Timeout).

Workspace package `@lakatos/pabst`: the `refute` API (`src/refute.ts`, barrel `src/index.ts`), the `pabst` bin (`src/cli.ts`), and the `./runtime` export the generated tests import. It builds, tests, and typechecks from the repo root. The front half of a run (resolution, the typecheck gate, formula typing) is lemma's `admit`; the back half (run dir, interrupt guard, envelope, exit code) is core's `runTool`; pabst supplies only the spine. Annotation parsing is not here either: pabst consumes lemma's parsed `Binder`/`Formula` and owns only what is fast-check-specific.

## Where to start

- `src/refute.ts` — `refute()` and the refute spine: codegen into the run directory, vitest, the verdict join.
- `src/build-spec.ts` — lemma's output → one flat `PropertySpec` per annotation (`src/ir.ts`); `src/lower.ts` (`lowerTop`) flattens the formula to JS boolean text.
- `src/codegen.ts` + `src/emit.ts` — string-build one vitest file per source file; `src/enumerate.ts` picks exhaustive enumeration vs sampling; `src/domains.ts` renders arbitraries from lemma's bounds.
- `src/run.ts` — runs pabst's own vitest under the current node (no npx) and classifies the outcome.
- `src/contract.ts` — every string that must agree across emitted test ↔ `src/runtime.ts` ↔ the verdict decoder. `tests/contract-pins.test.ts` names every other spelling to update when one changes.
- `src/join.ts` — reads the issues back out of vitest's JSON and joins them onto the planned identities as `@lakatos/core` envelope entries; `buildEnvelope` is the test-side assembly.

## What the code can't tell you

- Generated tests import from `@lakatos/pabst/runtime`, resolved from the _target project's_ node_modules — which is why pabst must run from that project, and why the repo's own refute suites run in scratch directories inside the tree.
- Domains lemma cannot represent (an interval endpoint beyond the safe-integer range) yield no spec at all and report `NotTried` / `unsupported-range`, exactly as prove does: generating over a clamped domain would refute a narrower statement than the one written. The classification is lemma's (`clampedEndpoints`, `unsupportedRangeReason`), so the engines cannot diverge on it.
- A spec over at most 1,000 tuples (`ENUMERATION_CAP`) is walked in full and a clean pass is a Theorem marked `enumerated`; each enumerated test has a 4 s wall-clock budget (`LOOP_BUDGET_MS`), the source of the `budget` kind. Sampled specs run 1,000 cases (`SAMPLE_RUNS`) under a random 32-bit seed per run, reproducible with `--seed`.
- Run outcomes are `completed`, `no-results`, `broken-run`, and `interrupted`; an interrupted run reports `User`, never an error.

## Conventions

- **Generated code is disposable.** Every run writes a fresh directory; determinism comes from the seed.
- **Engine-neutral logic goes to `lemma/`; fast-check-specific logic stays here.** `domains.ts` must not re-derive bounds arithmetic.
- **Input faults throw `LemmaError`** (exit 2 with a one-line diagnostic); anything else escaping is an internal bug. An unrepresentable domain is not the input's fault: contained per annotation, never a run-level abort.
- **Never depend on thales**, and vice versa; sharing goes through `@lakatos/lemma` and `@lakatos/core`.

Stryker (`npm run mutation`, root config) targets pabst's sources but runs locally only; CI runs the vitest suite.
