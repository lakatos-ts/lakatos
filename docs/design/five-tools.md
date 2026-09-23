# Five tools, one repository — design

Date: 2026-09-23. Grilled with Jesse to completion (all branches resolved).

> This is a dated design record; it is not updated to track the code. For
> current layout and commands, the root `README.md` and each package's own
> `README.md` are authoritative.

## Driver

`lakatos` was imagined as a supertool: one CLI, one version, engines
underneath. A month after the consolidation into one repository, the
picture that emerged is different. Nobody uses `lakatos` as a tool; people
run `lakatos prove` or `lakatos refute`, and each of those is one engine.
The GitHub organization `lakatos-ts` is what lakatos is: an umbrella for a
family of tools that share a language and a result contract. The CLI at
the repo root had become the place where every engine's command-line logic
accumulated, and the whole was getting hard to hold in one head.

Two concrete needs drove the decision:

- Consumers who want one engine without the others. Property-based testing
  from JSDoc annotations has an audience that will never install a Lean
  toolchain.
- A programmatic TypeScript API for each engine, for editors, CI bots, and
  other tools, instead of shelling out to a CLI and parsing its output.

Codebase hygiene is the third motive: the layering that the root
`CLAUDE.md` states as a rule ("thales and pabst never depend on each
other; both may depend on lemma and tarski") should be enforced by package
boundaries, not by convention.

## Starting point

The import graph at the time of the decision already respects the intended
layering, with two leaks:

| Directory                     | In-repo dependencies                    |
| ----------------------------- | --------------------------------------- |
| `lemma/src`                   | none                                    |
| `engines/pabst/src`           | lemma, `src/interrupt.ts`               |
| `engines/thales/frontend/src` | lemma, `src/szs.ts`, `src/interrupt.ts` |
| `tarski/frontend/src`         | none (own bin `tarski-test262`)         |
| `src/cli.ts`                  | pabst, thales, lemma                    |

The leaks are the two engines importing upward into the CLI package for
interrupt handling and the SZS status vocabulary.

## Decisions

**D1. One repository, npm workspaces.** Separate repositories were ruled
out. A lemma grammar change lands in one PR together with both engines and
the conformance corpus; across repositories that becomes a release and two
follow-up PRs with a window in which the engines disagree on the language.
Workspaces give each tool a real `package.json` (name, exports, bin,
dependencies) while keeping one lockfile, one `npm install`, one prettier,
one test run, and one CI. A package can import only what its manifest
declares, so the layering becomes a build error instead of a convention.

**D2. A `core` package for what every tool shares at runtime.** The
envelope, the SZS status vocabulary, the JSON schemas, interrupt handling,
and run-directory claiming move out of the CLI package into
`@lakatos-ts/core`. Lemma stays purely the language. The charter is one
line: what every lakatos-ts tool shares at runtime, with no language and
no engine code.

**D3. The supertool is dropped.** No `lakatos` command survives. The
`check` subcommand, which was a NotTried stub, goes with it. The `lakatos`
package on npm is deprecated with a message naming the new packages; it is
not turned into a meta-package that installs the others, since that would
quietly reintroduce what was just removed.

**D4. One result contract across the tools.** Every tool's bin emits the
same envelope with SZS statuses, and the schema lives in `core`. The value
of a programmatic API across engines is that a consumer handles one result
type; the envelope, the vocabulary, and the schema already exist and are
tested, so dropping them would lose the one thing the umbrella actually
delivered.

**D5. Thales stays checkout-only for now.** `prove` walks up from its own
module to find a lakefile, runs `lake build`, and requires tarski by
relative path; its own error message says "run prove from a lakatos
checkout". No package boundary changes that. Making thales installable
(Lean sources in the package, tarski as a lake git dependency, first-run
build, elan as a documented prerequisite) is a distribution project of its
own and is filed as a follow-up. The split must not make it harder: the
thales package's Lean side stays one lake project whose only external
requirement is tarski.

**D6. A Lean TypeScript parser is a tarski project, sequenced after the
split.** Considered and deferred. A parser gives syntax trees, not types,
and both lemma and thales lean on the TypeScript type checker (the
typecheck gate, island types, class domains, inferred locals), so a Lean
parser does not get thales off Node. A Lean-side front end for annotated
files would also mean two implementations of the language, one per
engine. The ESTree JSON seam between the bridge and the evaluator already
exists, so a Lean parser can be built inside tarski, emit ESTree, and be
checked differentially against the bridge on test262 and on real
TypeScript files at scale. Its first deliverable is that differential exe,
not a replacement. Filed as a follow-up.

**D7. Tarski is a first-class tool.** `@lakatos-ts/tarski` owns the
TypeScript bridge, the test262 runner and its bin, and the ESTree schema.
It depends on nothing else in the repository. The Lean library is
distributed by lake, as now. Its charter already forbids requiring any
engine, and it is the natural home for D6.

**D8. Lemma owns its spec and the typecheck gate.** `spec/` (grammar,
semantics prose, conformance fixtures) moves under `lemma/`; the spec and
its reference implementation version together. The typecheck gate stays in
lemma because lemma owns the TypeScript-compiler dependency and both
engines already need it before discovery.

**D9. Names.** Packages are scoped under the organization:
`@lakatos-ts/core`, `@lakatos-ts/lemma`, `@lakatos-ts/pabst`,
`@lakatos-ts/thales`, `@lakatos-ts/tarski`. Bins are unscoped: `pabst`,
`thales`, `tarski-test262`. Pabst's runtime export becomes
`@lakatos-ts/pabst/runtime`, and the generated tests' import string
changes with it; that is one of the few user-visible changes.

**D10. Independent semver per package.** "One product, one version" ends
with the supertool. Lemma bumps when the language changes; engines declare
caret ranges on lemma and core. Publish order is lemma and core first,
then engines. Inside the repository, workspace links resolve to local
source, so a PR touching lemma and both engines tests as one unit even
though they publish separately. No release tooling beyond `npm version`
and `npm publish` with `-w`.

**D11. Single-verb bins and a shared `.lakatos/` run directory.** Each
tool does one thing, so `pabst [--seed <n>] [files...]` and
`thales [files...]`, with the exit-code rules the old CLI had. Both claim
a timestamped run directory under `.lakatos/` and share the typecheck
cache there, so users gitignore one line.

**D12. The root stays the driver for build, test, and CI.** Root
`tsconfig.json` becomes project references over the package tsconfigs;
root vitest lists the packages as projects; `npm test`, `npm run
typecheck`, `npm run format:check`, and the coverage gate keep running
from the root. The three workflows do not change in this split. Path
filtering so a pabst-only PR skips Lean is worth doing, since Lean is the
CI cost, but the thales and tarski checks are merge-required and a skipped
required check blocks the merge queue unless the workflows always report.
That restructuring is filed as a follow-up.

**D13. Five siblings at the root.** `core/`, `lemma/`, `pabst/`,
`thales/`, `tarski/`, each with its own `package.json`, `README.md`, and
`CLAUDE.md`. `engines/` disappears with the framing that named it; `src/`
and `tests/` at the root disappear with the CLI. Moving thales changes its
lake path to tarski, the CI working directories, and the Lake cache keys,
once.

**D14. Six bottom-up PRs, the old CLI alive until the last.** Nothing in
the split is uncertain, so a tracer bullet earns nothing; each PR is a
mechanical move that keeps main green:

1. Root becomes a private workspace root; `core/` is extracted with its
   tests; engines import it by package name.
2. `lemma/` gets its package; `spec/` moves in.
3. `pabst/` moves to the root, gets its package, its bin, and the
   refute-side CLI tests.
4. `thales/` moves to the root, gets its package, its bin, the prove-side
   tests, the e2e and verdict corpus; lake path and CI paths updated.
5. `tarski/` gets its package and takes over `tarski-test262` and the
   ESTree schema.
6. `src/` and `tests/` deleted, `check` gone, README rewritten as the
   umbrella, `lakatos` deprecated on npm, first publishes.

`lakatos prove` and `lakatos refute` keep working through step 5, so the
old and new bins can be diffed on the verdict corpus before the old one is
deleted.

## Issues

Epic #542; children #543 through #548 in the order of D14. Follow-ups:

- Installable thales (D5): #549.
- A Lean TypeScript parser in tarski with a differential-testing exe (D6): #550.
- Path-filtered CI that still satisfies the required checks (D12): #551.
