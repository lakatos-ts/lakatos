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
`../tarski`. Build the checkout once with `npm install && npm run build`
at its root, then run thales from your project's directory, where its
`tsconfig.json` is:

```bash
node path/to/lakatos/thales/dist/cli.js                   # discover sources, prove, print a JSON report
node path/to/lakatos/thales/dist/cli.js <files-or-globs>  # same, on an explicit file list
```

(npm links the `thales` bin before the build creates its target, so in a
fresh checkout `npx thales` finds a file it cannot execute; `node` does not
care.)

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

## Running a file: `thales-exe`

```bash
node path/to/lakatos/thales/dist/exe-cli.js <file.ts>
```

`thales-exe` runs one TypeScript file on the tarski evaluator, the Lean
definitions thales proves against. `console.log` goes to stdout; an
uncaught throw's class and message go to stderr with exit 1. It needs the
same lakatos checkout and Lean toolchain as `thales`, and it accepts
exactly the programs `thales` accepts: the same typecheck gate, with the
same refusals (exit 2).

Its honesty limits are the proofs' own. A proof's model is checked against
the evaluator per declaration, and the envelope's `model` field says
whether it was and why not; refute (pabst) runs on Node, not on this
evaluator.

## Building

```bash
lake build                  # from thales/: ThalesDsl, tarski's Js first
npm run build               # from the repo root: the TypeScript, to thales/dist/
```
