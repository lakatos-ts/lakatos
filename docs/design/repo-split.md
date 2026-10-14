# Splitting the monorepo — design

Date: 2026-10-14. Grilled with Jesse to completion (all branches resolved).

> This is a dated design record; it is not updated to track the code. After
> the split, each repo's own README and CLAUDE.md are authoritative.

## Why

One repo holds a TypeScript project (pabst) and a Lean project (tarski and
thales), with two toolchains, five packages, and CI dominated by Lean. The
split is wanted for two reasons: the monorepo is too much to hold in one's
head, and pabst should release on its own cadence without Lean in its
contributor setup or its tracker. Lean CI weight is the trigger, not the
reason; path filters alone would not have justified the surgery.

## The line is the `tsc` seam, not the language

Nothing in Lean reads TypeScript. The parser is `tarski/frontend` (a bridge
over `tsc` emitting ESTree JSON), and thales's emitter reads `tsc`'s AST and
writes per-declaration JSON that the Lean `thales-emit` renders. `tsc` is
also the type-checking oracle: a program that does not pass strict `tsc` is
refused, and Lean never duplicates that check. Once a program has passed
the gate and its types are stripped, what runs is JavaScript.

So the split runs along the JSON seam: everything that needs `tsc` is
TypeScript and lives in `lemma`; everything that needs Lean is in `thales`.
A Lean-native TypeScript parser was considered and rejected: parsing is
feasible, but the oracle is `tsc`'s checker, so node is needed at run time
regardless.

## Repos

All under the `lakatos-ts` GitHub org. Locally each is an independent clone
inside `~/src/lakatos`, listed in the umbrella's `.gitignore`.

- **`lakatos` (umbrella).** This repo, history intact. README, the canonical
  `spec/` (the envelope and SZS JSON schemas, the output contract both
  engines honor), `scripts/clone-all`, and a scheduled prove/refute parity
  job against the latest release of each engine. Parity is never a required
  check, so no repo's merge waits on another's.
- **`thales` (pure Lean, one lake package).** Libraries `Js`, `Tarski`,
  `ThalesDsl`, `ThalesEmit`; executables:
  - `tarski foo.ts` — run one gated TypeScript file on the evaluator (what
    `thales-exe` is today);
  - `thales foo.ts` — extract the annotations and attempt the proofs,
    writing the envelope, handling interrupts, and creating the run
    directory natively in Lean (`thales-emit` folds into it);
  - `tarski-test262` — the test262 runner, rewritten in Lean.
    The boundary rule stays: nothing under `Js/` or `Tarski/` imports
    `ThalesDsl` or `ThalesEmit`, enforced by a CI script now that a lake
    `require` no longer enforces it. The merge queue stays here (elan
    flakiness). Popper's issues come here too.
- **`lemma` (TypeScript, TS 6 pinned).** The Lemma language and its spec,
  the `tsc` gate, the ESTree bridge and type stripping from
  `tarski/frontend`, and (for now) thales's emitter. A bin with `lemma check`
  (gated) and `lemma parse` (ungated, for test262), both with `--jsonl`
  batch mode. It prints one checked-program document per file.
- **`pabst` (TypeScript).** The refuter, with `core`'s runtime (envelope,
  SZS, interrupt, run directories) folded in. `@lakatos/core` is retired.

## The checked-program document

lemma owns its schema, ships it in the npm package, and stamps every
document with `schemaVersion`; a breaking change is a major bump. thales
pins one exact lemma version as a constant and checks it against the
document.

v0 is thales's current emission IR, moved as is, so the split does not wait
on a rewrite. The target is an engine-neutral document — ESTree, parsed
Lemma annotations, `tsc` type facts per binder and declaration, the module
graph, the gate's verdict — with thales's lowering (emission, readings,
join) rewritten in Lean, inside the thales repo, after the split. pabst can
read the same document.

## How the Lean side reaches lemma

The Lean executables start lemma as a subprocess. To keep start-up off the
hot path, the first run installs the pinned lemma into
`~/.cache/lakatos/lemma@<version>` and thereafter runs `node` on it directly
rather than through `npx`. `LAKATOS_LEMMA=<checkout>` points at an
unreleased lemma for development. Batch mode exists for test262, which is
tens of thousands of files.

`tarski foo.ts` always gates. Only test262 asks for `lemma parse`, and the
document records `gated: false`: test262 measures how much JavaScript the
evaluator covers, which is the question once `tsc` has accepted a program.

## TypeScript 7

TypeScript 7's Go compiler drops the in-process compiler API (#246). lemma
stays on TS 6. Because the document is the contract, a later move to
tsgo's IPC or LSP API is internal to lemma; #246 moves to the lemma repo.

## Distribution and versions

`tarski` ships prebuilt per-platform binaries from GitHub Releases. `thales`
cannot be self-contained (it runs `lake env lean` against built oleans), so
it is used from a checkout for now, with a release tarball of prebuilt
oleans for the pinned toolchain as the later goal.

Each repo versions independently from 0.2.0; thales gets Lean tags and
release artifacts. `@lakatos/core`, `@lakatos/tarski`, and `@lakatos/thales`
are `npm deprecate`d with a pointer to the new home, not unpublished.

## Migration: reshape, then split

Every cross-cutting change lands first as an ordinary PR in this monorepo,
where it can be atomic and CI checks it whole:

1. The envelope schema (which carries the SZS vocabulary) moves to
   `spec/`. Folding `core`'s TypeScript into pabst waits until step 5 has
   removed thales's TypeScript: until then thales imports `core` too, and
   importing it from pabst would break the rule that the engines never
   depend on each other.
2. `tarski/frontend`'s bridge and type stripping move into lemma; lemma
   gains its bin (`check`, `parse`, `--jsonl`); thales's TypeScript calls
   the bin instead of importing the code.
3. thales's emitter (`emission*.ts`, `readings`, `module-graph`) moves into
   lemma; its output becomes the checked-program document v0.
4. A Lean `tarski` entry point that resolves lemma (cache,
   `LAKATOS_LEMMA`) and reads `.ts`, replacing `thales-exe`.
5. A Lean `thales` entry point: `cli`, `run`, `prove`, `join`, the
   envelope, interrupts, and run directories ported to Lean; the thales npm
   package goes away.
6. The test262 runner rewritten in Lean on lemma's batch mode.
7. `tarski/` and `thales/` become one lake package, with the boundary
   check script.
8. The root `tests/` is redistributed — layering is deleted (repo
   boundaries enforce it), the Lemma surface check goes to lemma, the trust
   section check to thales, parity to the umbrella — and the root workspace
   shrinks to lemma and pabst (and `core`, until it folds into pabst).

Then the split, mechanically, with `git filter-repo`. Because files move
during the reshaping, each repo's path set is every path its files have
ever had (`git log --follow --name-only`), renamed into the final layout:

| Repo    | Sources                                                      |
| ------- | ------------------------------------------------------------ |
| thales  | `thales/`, `tarski/` (Lean parts)                            |
| lemma   | `lemma/`, `tarski/frontend/`, the emitter's historical paths |
| pabst   | `pabst/`, `core/`                                            |
| lakatos | stays; a final commit deletes the engine directories         |

Each new repo is verified by building and testing from a fresh clone.

## Issues and tracking

Open issues transfer by label: `engine:tarski`, `engine:prove`,
`engine:popper`, and the Lean CI issues (#607, #608, #612) to thales, with
epic #376; `engine:refute` to pabst; #41 and #246 to lemma. #551, #534, and
#416 close as superseded by the split. Cross-engine issues (#12, #586) stay
on the umbrella. Labels and triage conventions are copied to each repo.
Transferred issues are renumbered and old `#NNN` references in the code are
left as they are; there are no downstream consumers to protect.

Beads gets one Dolt database per repo, since beads are steps toward GitHub
issues and the issues now live per repo.
