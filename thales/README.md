# Thales

The proof tool of [lakatos](../README.md), published as `@lakatos/thales`. Thales maps TypeScript
programs and their Lemma `@ensures` annotations to Lean 4 and attempts
proofs, reporting one SZS verdict per annotation. (The other blessed
annotations, `@throws` and `@total`, are specified as TODO in
[`lemma/spec/semantics.md`](../lemma/spec/semantics.md) and are not handled yet.)

Thales accepts essentially all TypeScript. That does not mean all of
TypeScript maps cleanly to Lean: constructs outside the mappable subset
degrade gracefully — only the annotations whose proofs depend on them are
reported as `Inappropriate` (with the offending construct named), and every
other annotation still gets a real proof attempt.

## Architecture

The engine is elaboration-based, in the language-oriented-programming
tradition:

1. **Front end (TypeScript).** The TS compiler API parses the target file;
   each declaration it can model becomes per-declaration JSON, which the
   `thales-emit` executable renders as ordinary Lean — a `def` per function
   in a computable monad, a `#thales_prove` command per annotation. What it
   cannot model it classifies itself, naming the offending construct, so
   nothing unmappable reaches Lean.
2. **ThalesDsl (Lean).** `#thales_prove` states each annotation's theorem,
   runs the proof ladder (`decide` over bounded domains, then generic
   tactics), and prints one JSON verdict line to stdout.
3. **The `thales` bin.** Collects the verdict lines and assembles the
   standard per-annotation envelope.

The engine is a ground-up rewrite of the previous whole-file
subset-checking compiler, which has been removed; the pipeline above works
end to end, and the model grows slice by slice (docs or comments that
mention the old compiler's vocabulary predate the rewrite).

## Usage

Thales runs from a lakatos checkout with the Lean toolchain
([elan](https://github.com/leanprover/elan)): `lake` builds the Lean side
from this directory, which requires the JS-semantics library in
`../tarski`. From the checkout's root, after `npm install && npm run build`:

```bash
npx thales                          # discover sources, prove, print a JSON report
npx thales <files-or-globs>         # same, on an explicit file list
```

With no file arguments, thales proves the files `tsconfig.json` compiles.
Every run type checks the whole project first; a program that does not
compile is refused. Artifacts land in `.lakatos/<run>/thales/`.

Stdout is one JSON envelope, one entry per annotation with its SZS status
(the shape is pinned by
[`core/schemas/envelope.schema.json`](../core/schemas/envelope.schema.json));
stderr carries progress and diagnostics. The exit status is 0 when nothing
was refuted, 1 when something was, and 2 on bad input, an engine failure,
or an interrupted run.

From TypeScript:

```ts
import { prove } from "@lakatos/thales";

const { code, envelope } = await prove(["src/**/*.ts"]);
```

`prove` runs from the current directory, like the bin; pass
`{ io: { note, emit, raw } }` to take its stderr and the envelope yourself.

## Building

```bash
lake build                  # from thales/: ThalesDsl, tarski's Js first
npm run build               # from the repo root: the TypeScript, to thales/dist/
```
