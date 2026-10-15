# @lakatos/lemma

The Lemma annotation language, end to end: the language itself and its
reference implementation, versioned together.

- [`spec/`](spec/) — the language: `README.md` introduces it,
  `grammar.ebnf` is the normative grammar, `semantics.md` the prose
  semantics (including _What a Theorem rests on_), and `fixtures/` the
  conformance corpus, whose directory membership is the expectation.
- `src/` — the implementation the engines share: discovery of
  annotated files (`resolveFiles`), `@ensures` extraction (`extract`), the
  prefix and formula parsers (`parsePrefix`, `parseBody`), binder domains
  and their cardinalities, class-valued binder resolution, island typing,
  the strict-mode typecheck gate (`typecheckProject`), and the parser
  bridge from a script to the ESTree the tarski evaluator reads
  (`parseScript`, with `stripTypes` for a TypeScript file).
- [`schemas/`](schemas/) — `tarski-estree.schema.json`, the ESTree subset
  the bridge emits, and `lemma-document.schema.json`, what the bin prints.

The `lemma` bin is the front end as a process, for an engine that is not
written in TypeScript. It prints one checked-program document per file:
the program, or the reason there is none.

```bash
npx lemma check src/foo.ts            # type check the project, strip, parse
npx lemma check                       # no files: the files tsconfig.json compiles
npx lemma parse test.js               # parse as written, no type check
npx lemma check --jsonl "src/**/*.ts" # globs; one compact document per line
```

`check` type checks the project under its own `tsconfig.json` with
strict forced on top, as both engines do; `parse` is for plain
JavaScript such as test262, where the question is what the evaluator
covers. The exit status is 0 when every file has a program, 1 when any
was refused, and 2 on bad usage, a pattern matching nothing, or a tsconfig that cannot be read.

Install it with `npm install @lakatos/lemma`, and import the package,
not a path: `import { parseBody } from "@lakatos/lemma"`. The barrel `src/index.ts`
is the whole public surface; everything else under `src/` is internal.

Lemma depends on `typescript`, takes `fast-check` as a peer (its range and
string-pattern arbitraries must share the generated tests' copy), and
depends on nothing else in this repository.
