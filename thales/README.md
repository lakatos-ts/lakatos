# Thales

The proof tool of [lakatos](../README.md), a Lean executable. Thales maps TypeScript
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

1. **Front end (TypeScript, in [lemma](../lemma/)).** The TS compiler API
   parses the target file; each declaration it can model becomes
   per-declaration JSON, carried in lemma's checked-program document. What
   it cannot model it classifies itself, naming the offending construct,
   so nothing unmappable reaches Lean.
2. **ThalesDsl (Lean).** `#thales_prove` states each annotation's theorem,
   evaluates a bounded claim under the evaluation cap first and then runs
   the proof ladder for a kernel-checked proof (`decide` over bounded domains, then generic
   tactics), and prints one JSON verdict line to stdout.
3. **The `thales` executable (Lean).** Runs lemma, renders each file's
   emission as ordinary Lean (ThalesEmit) — a `def` per function in a
   computable monad, a `#thales_prove` command per annotation — runs Lean
   on each artifact, collects the verdict lines, and assembles the
   standard per-annotation envelope.

The engine is a ground-up rewrite of the previous whole-file
subset-checking compiler, which has been removed; the pipeline above works
end to end, and the model grows slice by slice (docs or comments that
mention the old compiler's vocabulary predate the rewrite).

## Usage

Thales runs from a lakatos checkout with the Lean toolchain
([elan](https://github.com/leanprover/elan)) and Node: `lake` builds the
Lean side from this directory, which requires the JS-semantics library in
`../tarski`, and lemma, the TypeScript front end, runs as a subprocess.
Build the checkout once — `npm install && npm run build` at its root,
`lake build thales` here — then run the binary from your project's
directory, where its `tsconfig.json` is:

```bash
path/to/lakatos/thales/.lake/build/bin/thales                   # discover sources, prove, print a JSON report
path/to/lakatos/thales/.lake/build/bin/thales <files-or-globs>  # same, on an explicit file list
```

Until lemma 0.2.0 is published, point thales at the checkout's lemma with
`LAKATOS_LEMMA=path/to/lakatos/lemma`.

With no file arguments, thales proves the files `tsconfig.json` compiles.
Every run type checks the whole project first; a program that does not
compile is refused. Artifacts land in `.lakatos/<run>/thales/`.

Stdout is one JSON envelope, one entry per annotation with its SZS status
(the shape is pinned by
[`spec/envelope.schema.json`](../spec/envelope.schema.json));
stderr carries progress and diagnostics. The exit status is 0 when nothing
was refuted, 1 when something was, and 2 on bad input, an engine failure,
or an interrupted run.

Thales sees an interruption only through the child it is running: a
`lake` or Lean run that dies of SIGINT, SIGTERM, or SIGHUP that thales did
not cause stops the run and reports `User`. Thales installs no signal
handler, so a signal that reaches thales itself, a terminal Ctrl-C among
them, ends it with no envelope.

## Building

```bash
lake build thales           # from thales/: the binary, ThalesDsl and tarski's Js first
npm run build               # from the repo root: lemma, which the binary runs
```
