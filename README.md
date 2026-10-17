# Lakatos

Proofs and refutations for TypeScript.

You state a property of a function in a JSDoc annotation. Lakatos tries to
**refute** it — thousands of generated inputs hunting for a counterexample —
and tries to **prove** it, for all inputs, with a theorem prover.

```ts
/**
 * @ensures{nonzero} forall (x: bigint) (y: number) {
 *   Number.isInteger(y) ==> foo(x, y) !== 0
 * }
 */
export function foo(x: bigint, y: number): number {
  return Number(x % 2n) + (y % 2) + 1;
}
```

The name is from Imre Lakatos's _Proofs and Refutations_: mathematics
advances by conjectures, attempted proofs, and counterexamples that force
the conjecture to be repaired. That loop is what these tools run.

## The tools

Lakatos is five sibling tools: four npm packages under the `@lakatos`
scope and thales, a Lean executable. Each one's README says how to install
and use it on its own.

- [`@lakatos/pabst`](pabst/) — refutation. The `pabst` bin compiles each
  `@ensures` property to [fast-check](https://fast-check.dev/) runs and
  reports a counterexample when it finds one:

  ```bash
  npm install --save-dev @lakatos/pabst
  npx pabst src/foo.ts
  ```

- [`thales`](thales/) — proof. A Lean executable that renders annotated
  TypeScript as plain Lean 4 and attempts a proof per property. It needs a
  lakatos checkout with the Lean toolchain
  ([elan](https://github.com/leanprover/elan)), built once with
  `npm install && npm run build` at the root and `lake build thales` in
  `thales/`, and runs from your project's directory:

  ```bash
  LAKATOS_LEMMA=path/to/lakatos/lemma path/to/lakatos/thales/.lake/build/bin/thales src/foo.ts
  ```

  (`LAKATOS_LEMMA` points thales at the checkout's lemma until lemma
  0.2.0 is published.)

- [`tarski/`](tarski/) — the JavaScript semantics: the Lean
  library the proofs are stated against, an evaluator over the same
  definitions, the `tarski` executable, which runs one TypeScript file on
  that evaluator behind thales's typecheck gate
  ([running a file](tarski/README.md#running-a-file-tarski-filets)), and
  `tarski-test262`, which runs test262 against it. Both are Lean
  executables built with `lake` in `tarski/`; there is no npm package.
- [`@lakatos/lemma`](lemma/) — the Lemma annotation language and the
  TypeScript front end both engines share: its [spec](lemma/spec/), the
  discovery, extraction, parsing, and typecheck gate, the parser bridge
  to the evaluator's ESTree, thales's emitter, and the `lemma` bin,
  which prints one checked-program document per file (for now carrying
  the emitter's per-declaration JSON as its `emission`, and each
  annotation's outcome).
- [`@lakatos/core`](core/) — the shared runtime: the result envelope,
  the SZS vocabulary, interrupt handling, and run directories. The
  envelope's JSON Schema, the output contract both engines honor, is
  [`spec/envelope.schema.json`](spec/envelope.schema.json).

Properties are written in [Lemma](lemma/spec/), a little specification
language embedded in JSDoc; annotated files remain ordinary TypeScript
accepted by `tsc --strict`. Both engines type check the whole project
first, under its own `tsconfig.json` with strict forced on top, and refuse
a program that does not compile.

Every run writes its artifacts into its own directory under `.lakatos/`,
named for the run's start time in UTC — the same instant the report
carries as `startedAt`. Nothing is overwritten and nothing is pruned: add
`.lakatos/` to your `.gitignore` and delete it when you want the space
back.

## The result envelope

Every pabst and thales run prints one JSON envelope on stdout (schema:
[`spec/envelope.schema.json`](spec/envelope.schema.json)),
listing every scraped annotation with an [SZS ontology](https://tptp.org/UserDocs/SZSOntology/)
status:

| Outcome                                                            | SZS status           |
| ------------------------------------------------------------------ | -------------------- |
| proved for all inputs, or every tuple of a finite domain evaluated | `Theorem`            |
| falsified (counterexample)                                         | `CounterSatisfiable` |
| property body threw / prover errored                               | `Error`              |
| generation exhausted / passed / gave up                            | `GaveUp`             |
| engine ran out of budget (prover attempt, refuter walk)            | `Timeout`            |
| annotation depends on unmappable code                              | `Inappropriate`      |
| not attempted (unsupported ranges, unhealthy runs)                 | `NotTried`           |
| malformed annotation input                                         | `InputError`         |
| run interrupted before evaluating it                               | `User`               |

`pabst` walks a domain of at most 1,000 tuples in full instead of sampling
it, so a clean pass over such a domain is a `Theorem` with
`kind: "enumerated"` and `cases`, the number of tuples evaluated; a walk
that outruns its wall-clock budget is a `Timeout` with `kind: "budget"`.
Larger domains are sampled, 1,000 runs per property, and the two sampled
`GaveUp` cases are distinguished by the `kind` field: present
(`"exhausted"`) when generation gave up, absent when every run passed.

A prover's `Theorem` also carries `model`, what the prover established
about the model the property was proved over:
`{ "status": "validated" }` when the model was proved equal to the
evaluator's run of the declaration's own syntax tree, and
`{ "status": "unvalidated", "reason": "…" }` when it was not — a
construct the model has no run for, a proof that did not go through, an
exhausted budget, or a declaration no obligation was stated for. The
prover's `GaveUp`, `Timeout`, `CounterSatisfiable`, and `Inappropriate`
carry it too where the prover reached them; a refuter entry never does.

`NotTried` also covers unhealthy runs: when the underlying engine run
fails outright — the test runner dies before reporting, a generated test
can't even load, the Lean toolchain is missing, the Lean run fails, or
its verdict lines are malformed — no property was actually evaluated, so
the run reports every scraped annotation `NotTried`, keeps the
diagnostics on stderr, and exits 2. Stdout is one parseable envelope in
every mode.

`User` covers interrupted runs: Ctrl-C at the terminal, a supervisor's
SIGTERM, a CI cancel. The run stops, every annotation it had not
finished evaluating reports `User` with the signal in its `reason`,
annotations already resolved keep the status they earned, and the run
exits 2. For pabst this holds for a signal that arrives while its vitest
is running, which is where a run spends nearly all of its time. thales
sees an interruption only through the lake or Lean child it is running:
one that dies of SIGINT, SIGTERM, or SIGHUP that thales did not cause
stops the run the same way, but a signal that reaches thales itself, a
terminal Ctrl-C among them, ends it with no envelope. Outside those
windows, and for SIGKILL anywhere, the tool dies as any process does and
prints nothing: not a contract a tool can keep, so none claims to.

`InputError` marks an annotation whose input is malformed at extraction
— a duplicate property name (all claimants of the ambiguous identity
collapse into one entry), or an `@ensures` on an inaccessible subject
such as a non-exported class or a non-public member. Sound annotations
in the same run still get real verdicts; the entry's `error` field
carries the diagnostic, and the run exits 2. Subjects without a proper
name still get entries under best-effort labels (`<anonymous>#m`,
`Box#<computed>`), with the diagnostic saying what is unsupported.

Exit codes: `0` — nothing refuted; `1` — a counterexample found; `2` —
usage or input error, or an engine failure, including an unhealthy or
interrupted run.

## Architecture

```
          lemma (annotations)   core (envelope, SZS, run dirs)
                 \                /
         pabst (refute)      thales (prove) ── tarski (JS semantics)
```

The engines never depend on each other; both may depend on `core`,
`lemma`, and `tarski`, which depend on no engine.

What a `PROVED` verdict rests on — per declaration, the envelope's
`model` field says whether the prover's model was proved equal to the
evaluator's run of it, and why not — and the limits that remain are
stated in the spec's
[What a Theorem rests on](lemma/spec/semantics.md#what-a-theorem-rests-on).

## Layout

One repository, an npm workspace of [`core/`](core/), [`lemma/`](lemma/),
[`pabst/`](pabst/), and [`tarski/`](tarski/), beside the Lean
[`thales/`](thales/). The root is private: it builds, typechecks, tests,
and formats every TypeScript package, runs thales's suites and check
scripts, holds CI, and keeps the repository-wide tests in `tests/`
(layering, the Lemma surface, the trust section, prove-and-refute parity,
and the emission corpus pin, `tests/emission-corpus.test.ts`).

## License

MIT.
