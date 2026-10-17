import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

const root = process.cwd();

// The Lean tests and CI run the binary on their own copies of the parser
// bridge's goldens, which live with the bridge in lemma. The two must not
// drift: the schema is only a seam if both languages see the same bytes.
describe("the documents the Lean tests are run against", () => {
  for (const name of [
    "numeric-loop",
    "counter",
    "errors",
    "uncaught",
    "harness-floor",
    "compare-array",
    "print",
    "number-math",
    "for-switch-var",
    "number-conversions",
    "class-box",
    "class-elements",
    "emitter-classes",
    "hoisting-arguments",
    "exe-example",
    "object-function",
    "template-object",
    "symbol-json-error",
    "string-builtins",
    "iterators",
    "array-builtins",
  ]) {
    it(`agree with lemma's golden for ${name}`, () => {
      const lean = path.join(
        root,
        "thales/Test/Tarski/fixtures",
        `${name}.json`,
      );
      const golden = path.join(
        root,
        "lemma/tests/fixtures",
        `${name}.estree.json`,
      );
      expect(readFileSync(lean, "utf8")).toBe(readFileSync(golden, "utf8"));
    });
  }
});
