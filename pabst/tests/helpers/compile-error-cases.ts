// User-facing compile errors (malformed formulas, unsupported constructs,
// bad references) must exit 2 with a one-line diagnostic, not escape main()
// as an uncaught exception. One case per LemmaError-throwing module keeps
// the whole compile front-end pinned to the contract: reverting any module's
// throws to plain Error fails its case here. These run pabst —
// compilation fails before vitest is spawned, so no timeout is needed.
//
// `wrapped` marks errors thrown per-annotation inside buildSpec, which the
// build-spec seam prefixes with `file:line: @ensures{name}:`. Extract-phase
// input errors (duplicate names, ineligible/unexported/unnameable subjects)
// no longer throw at all — they surface as per-annotation InputError
// entries (see cli-usage.test.ts).
export interface CompileErrorCase {
  name: string;
  file: string;
  source: string;
  wrapped: boolean;
  property: string;
  /** True when lemma's own parsers throw the error — the rejects both
   * engines must refuse identically. False marks refute-only resolution
   * checks (unexported references, unresolvable domains). */
  parseLevel: boolean;
  expected: string[];
}

export const COMPILE_ERROR_CASES: CompileErrorCase[] = [
  {
    name: "a malformed quantifier prefix (prefix-parser)",
    file: "malformed.ts",
    source: `/** @ensures{shapely} for every (n: nat), malformed(n) >= 0 */\nexport function malformed(n: number): number { return n; }\n`,
    wrapped: true,
    property: "shapely",
    parseLevel: true,
    expected: ["expected 'forall'"],
  },
  {
    name: "a leading existential quantifier (prefix-parser)",
    file: "existential.ts",
    source: `/** @ensures{someone} exists (n: nat), ex(n) > 0 */\nexport function ex(n: number): number { return n; }\n`,
    wrapped: true,
    property: "someone",
    parseLevel: true,
    expected: ["existential quantifiers"],
  },
  {
    name: "an unresolvable domain (class-domain resolution)",
    file: "baddomain.ts",
    source: `/** @ensures{rounds} forall (x: float) { rounder(x) >= 0 } */\nexport function rounder(x: number): number { return x; }\n`,
    wrapped: true,
    property: "rounds",
    parseLevel: false,
    expected: [
      "domain 'float' is neither a primitive domain",
      "nor an exported class declared in",
    ],
  },
  {
    name: "an existential inside the body (formula-lexer)",
    file: "bodyexists.ts",
    source: `/** @ensures{someInBody} forall (n: nat) { inBody(n) > 0 ∧ exists m, inBody(m) === 0 } */\nexport function inBody(n: number): number { return n; }\n`,
    wrapped: true,
    property: "someInBody",
    parseLevel: true,
    expected: ["existential quantifiers"],
  },
  {
    name: "a nested forall inside the body (formula-lexer)",
    file: "nestedforall.ts",
    source: `/** @ensures{deep} forall (n: nat) { forall (m: nat) { nested(n) >= 0 } } */\nexport function nested(n: number): number { return n; }\n`,
    wrapped: true,
    property: "deep",
    parseLevel: true,
    expected: ["nested quantifiers"],
  },
  {
    name: "JS && at the property's top level (formula-parser)",
    file: "jsconj.ts",
    source: `/** @ensures{conj} forall (n: nat) { jsconj(n) >= 0 && jsconj(n) >= 0 } */\nexport function jsconj(n: number): number { return n; }\n`,
    wrapped: true,
    property: "conj",
    parseLevel: true,
    expected: ["use ∧ for conjunction"],
  },
  {
    name: "a comma-separated binder group (prefix-parser)",
    file: "commagroup.ts",
    source: `/** @ensures{p} forall (a: number, b: number) { 0 <= commagroup(a) } */\nexport function commagroup(a: number, b: number): number { return a; }\n`,
    wrapped: true,
    property: "p",
    parseLevel: true,
    expected: ["invalid domain 'number, b: number'"],
  },
];
