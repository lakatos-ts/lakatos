# @lakatos-ts/lemma

The Lemma annotation language, end to end: the language itself and its
reference implementation, versioned together.

- [`spec/`](spec/) — the language: `README.md` introduces it,
  `grammar.ebnf` is the normative grammar, `semantics.md` the prose
  semantics (including _What a Theorem rests on_), and `fixtures/` the
  conformance corpus, whose directory membership is the expectation.
- `src/` — the implementation the engines and the CLI share: discovery of
  annotated files (`resolveFiles`), `@ensures` extraction (`extract`), the
  prefix and formula parsers (`parsePrefix`, `parseBody`), binder domains
  and their cardinalities, class-valued binder resolution, island typing,
  and the strict-mode typecheck gate (`typecheckProject`).

Import the package, not a path:
`import { parseBody } from "@lakatos-ts/lemma"`. The barrel `src/index.ts`
is the whole public surface; everything else under `src/` is internal.

Lemma depends on `typescript` and on nothing else in this repository.
