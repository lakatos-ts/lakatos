import { describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { admittedDocument, type Emission } from "@lakatos/lemma";
import { schemaValidator } from "./helpers/schema-validator.js";

// lemma's emitter over thales's own corpus: the fixtures the envelope
// check proves, the conformance corpus, and the emission goldens the Lean
// tests under `Test/ThalesEmit/` render. The emitter's unit tests are
// lemma's; these pin what thales consumes, through lemma's barrel.

/** lemma ships its schemas beside its entry point. */
const lemmaSchemas = new URL(
  "../schemas/",
  import.meta.resolve("@lakatos/lemma"),
);

const expectValidEmission = schemaValidator(
  new URL("thales-emission.schema.json", lemmaSchemas),
  "emission",
  [new URL("tarski-estree.schema.json", lemmaSchemas)],
);

/** The emission lemma documents `file` with, as thales writes it. */
function emissionOf(file: string): Emission {
  return admittedDocument(file, new Map()).emitted.emission;
}

describe("the emission over thales's fixtures", () => {
  test.each([
    ["thales/tests/fixtures/tracer.ts"],
    ["thales/tests/fixtures/statements.ts"],
    ["thales/tests/fixtures/binders.ts"],
    ["thales/tests/fixtures/degradations.ts"],
    ["thales/tests/fixtures/classes.ts"],
    ["thales/tests/fixtures/class-params.ts"],
    ["thales/tests/fixtures/module-consts.ts"],
    ["thales/tests/fixtures/nested-class-binder.ts"],
    ["thales/tests/fixtures/unions.ts"],
    ["thales/tests/fixtures/optionals.ts"],
    ["thales/tests/fixtures/defaults.ts"],
    ["thales/tests/fixtures/ctor-defaults.ts"],
    ["thales/tests/fixtures/instance-defaults.ts"],
    ["thales/tests/fixtures/object-is-tagged.ts"],
    ["thales/tests/fixtures/fields.ts"],
    ["thales/tests/conformance/theorem/class-binder-equality-guards.ts"],
    ["thales/tests/conformance/theorem/boolean-classes.ts"],
  ])("the emission for %s validates against the schema", (fixture) => {
    expectValidEmission(emissionOf(fixture));
  });

  test.each([
    ["thales/tests/fixtures/tracer.ts", "tracer.emission.json"],
    ["thales/tests/fixtures/operators.ts", "operators.emission.json"],
    ["thales/tests/fixtures/statements.ts", "statements.emission.json"],
    ["thales/tests/fixtures/binders.ts", "binders.emission.json"],
    ["thales/tests/fixtures/degradations.ts", "degradations.emission.json"],
    ["thales/tests/fixtures/classes.ts", "classes.emission.json"],
    ["thales/tests/fixtures/class-params.ts", "class-params.emission.json"],
    ["thales/tests/fixtures/module-consts.ts", "module-consts.emission.json"],
    [
      "thales/tests/fixtures/nested-class-binder.ts",
      "nested-class-binder.emission.json",
    ],
    ["thales/tests/fixtures/unions.ts", "unions.emission.json"],
    ["thales/tests/fixtures/optionals.ts", "optionals.emission.json"],
    ["thales/tests/fixtures/defaults.ts", "defaults.emission.json"],
    ["thales/tests/fixtures/ctor-defaults.ts", "ctor-defaults.emission.json"],
    [
      "thales/tests/fixtures/instance-defaults.ts",
      "instance-defaults.emission.json",
    ],
    [
      "thales/tests/fixtures/object-is-tagged.ts",
      "object-is-tagged.emission.json",
    ],
    ["thales/tests/fixtures/fields.ts", "fields.emission.json"],
    [
      "thales/tests/conformance/theorem/class-binder-equality-guards.ts",
      "class-binder-equality-guards.emission.json",
    ],
    [
      "thales/tests/conformance/theorem/boolean-classes.ts",
      "boolean-classes.emission.json",
    ],
  ])(
    "the pinned emission for %s is exactly what lemma emits",
    (fixture, pin) => {
      const pinned = JSON.parse(
        fs.readFileSync(`thales/tests/fixtures/${pin}`, "utf8"),
      );
      expect(emissionOf(fixture)).toEqual(pinned);
    },
  );

  test("every stacked JSDoc block's @ensures becomes its own obligation", () => {
    const fixture = "thales/tests/conformance/theorem/stacked-blocks.ts";
    expect(emissionOf(fixture).obligations.map((o) => o.property)).toEqual([
      "nonNegative",
      "atLeastOne",
    ]);
  });
});

/** The declarations of the store's inputs that carry no ast by design, by
 * file: each closure binds a name to a differently spelled declaration,
 * and a script would need a renaming the emitter never writes. Naming
 * each one keeps any other exception visible. */
const WITHOUT_AST: Record<string, string[]> = {
  // #570: the importer's `b` is dep's `inner`.
  "thales/tests/conformance/theorem/aliased-export/main.ts": ["top"],
};

/** Every `.ts` the emission store is built from: acceptance criterion 1's
 * frontend half, every emitted declaration carries an ast, but for the
 * exceptions `WITHOUT_AST` names. */
function storeInputs(): string[] {
  const roots = ["thales/tests/fixtures", "thales/tests/conformance"];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // A declaration file is never an entry: it has no runtime statements
      // at all, which is why `tsc` declines to transpile one.
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
        out.push(full);
    }
  };
  for (const root of roots) walk(root);
  return out.sort();
}

describe("every emitted declaration carries its AST", () => {
  test.each(storeInputs())("%s", (file) => {
    const without = emissionOf(file)
      .declarations.filter((d) => d.kind !== "residual" && d.ast === undefined)
      .map((d) => (d.kind === "residual" ? "" : d.name));
    expect(without).toEqual(WITHOUT_AST[file] ?? []);
  });
});
