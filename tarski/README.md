# Tarski

`@lakatos/tarski` is the JavaScript semantics behind lakatos. The Lean
library in this directory gives TypeScript's values and operations their
meaning, and an evaluator over the same definitions runs a growing
fragment of JavaScript. The evaluator reads ESTree JSON, which lemma's
parser bridge produces (pinned by
[`lemma/schemas/tarski-estree.schema.json`](../lemma/schemas/tarski-estree.schema.json)).
The package's TypeScript is the `tarski-test262` bin, which runs
test262 against the evaluator.

The evaluator binary is built by `lake` from this directory, so the
package needs a lakatos checkout with the Lean toolchain:

```bash
npm install && npm run build        # the TypeScript, from the repo root
cd tarski
lake build tarski                   # the evaluator
node dist/test262/cli.js --slice-file test262/slice.txt
```

The TypeScript builds, typechecks, tests, and formats from the repository
root, like every other workspace package. Requires Node 24+.

## Running a file: `tarski <file.ts>`

```bash
path/to/lakatos/tarski/.lake/build/bin/tarski <file.ts>
```

`tarski` runs one TypeScript file on the evaluator, the Lean definitions
thales proves against. `console.log` goes to stdout; an uncaught throw's
class and message go to stderr with exit 1. It accepts exactly the
programs `thales` accepts: lemma type checks the project first, with the
same refusals (exit 2).

lemma is a subprocess. The first run installs the pinned release
(`@lakatos/lemma@0.2.0`) into `~/.cache/lakatos/lemma@0.2.0` with `npm`,
and later runs start `node` on it directly; `LAKATOS_LEMMA=<dir>` runs a
built lemma checkout instead, which is what a lakatos checkout uses until
that release is published:

```bash
LAKATOS_LEMMA=path/to/lakatos/lemma path/to/lakatos/tarski/.lake/build/bin/tarski src/foo.ts
```

Its honesty limits are the proofs' own. A proof's model is checked against
the evaluator per declaration, and the envelope's `model` field says
whether it was and why not; refute (pabst) runs on Node, not on this
evaluator.

Its output is the evaluator's, not Node's. `console.log` prints the
ToString of each argument, so an object prints as `[object Object]` rather
than Node's inspection, and `-0` prints as `0`.
