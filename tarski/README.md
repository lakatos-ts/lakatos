# Tarski

`@lakatos/tarski` is the JavaScript semantics behind lakatos. The Lean
library in this directory gives TypeScript's values and operations their
meaning, and an evaluator over the same definitions runs a growing
fragment of JavaScript. The evaluator reads ESTree JSON, which lemma's
parser bridge produces (pinned by
[`lemma/schemas/tarski-estree.schema.json`](../lemma/schemas/tarski-estree.schema.json)).
The package's TypeScript is a runner for the evaluator binary and the
`tarski-test262` bin, which runs test262 against the evaluator.

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
