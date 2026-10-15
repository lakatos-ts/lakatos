import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { writeEmissionArtifacts } from "../src/emission-artifacts.js";
import { admit, admittedDocument, annotationKey } from "@lakatos/lemma";

const OUT = "out";

const ANNOTATED =
  "/** @ensures{q} forall (x: int ∈ [0, 5)) { f(x) === x } */\nexport function f(x: number): number { return x; }\n";

const CLASS_BINDER =
  "export class Box { constructor(readonly size: number) {} }\n" +
  "/** @ensures{p} forall (b: Box) { volume(b) >= 0 } */\n" +
  "export function volume(b: Box): number { return b.size; }\n";

describe("writeEmissionArtifacts", () => {
  let dir: string;
  const prevCwd = process.cwd();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-emission-artifacts-"));
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "a.ts"), ANNOTATED);
    fs.writeFileSync(path.join(dir, "plain.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "boxed.ts"), CLASS_BINDER);
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Runs before the write tests: the assertion is that no artifact appears.
  test("a file whose only annotation was refused writes no artifact", () => {
    const source = path.join("sub", "a.ts");
    const refused = new Map([
      [
        annotationKey(source, { functionName: "f", propertyName: "q" }),
        "sub/a.ts:2: refused",
      ],
    ]);
    const [a] = writeEmissionArtifacts([source], OUT, refused);
    expect(a).toEqual({
      sourceFile: source,
      annotations: [],
      invalid: [],
      classified: [],
    });
    expect(fs.existsSync(path.join(OUT, "sub", "a.ts.json"))).toBe(false);
  });

  test("writes one lemma document per annotated file, mirrored", () => {
    const source = path.join("sub", "a.ts");
    const [a] = writeEmissionArtifacts([source], OUT);
    expect(a!.jsonFile).toBe(path.join(OUT, "sub", "a.ts.json"));
    expect(a!.leanFile).toBe(path.join(OUT, "sub", "a.ts.lean"));
    const written = JSON.parse(fs.readFileSync(a!.jsonFile!, "utf8"));
    // The document `lemma check` prints for a file with nothing refused:
    // thales-emit reads the emission out of it.
    expect(written).toEqual(admittedDocument(source, new Map()).document);
    expect(written).toMatchObject({
      schemaVersion: 1,
      gated: true,
      outcome: "program",
      emission: { file: source, obligations: [{ property: "q" }] },
    });
    expect(a!.annotations).toHaveLength(1);
    expect(a!.classified).toEqual([]);
    // The .lean artifact is thales-emit's to render, not the frontend's.
    expect(fs.existsSync(a!.leanFile!)).toBe(false);
  });

  test("an annotation-free file gets an entry but no artifact", () => {
    const [p] = writeEmissionArtifacts(["plain.ts"], OUT);
    expect(p).toEqual({
      sourceFile: "plain.ts",
      annotations: [],
      invalid: [],
      classified: [],
    });
    expect(fs.existsSync(path.join(OUT, "plain.ts.json"))).toBe(false);
  });

  test("a fully classified file keeps its JSON but plans no Lean artifact", () => {
    const [b] = writeEmissionArtifacts(["boxed.ts"], OUT);
    expect(b!.jsonFile).toBe(path.join(OUT, "boxed.ts.json"));
    expect(b!.leanFile).toBeUndefined();
    expect(b!.classified).toHaveLength(1);
    expect(b!.classified[0]!.szs).toBe("Inappropriate");
  });
});

// The path prove takes: admission's refusals go to writeEmissionArtifacts
// unchanged, and the document's `tried` must match the emission's obligations.
describe("writeEmissionArtifacts after admission", () => {
  let dir: string;
  const prevCwd = process.cwd();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-emission-admitted-"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", types: [] },
        include: ["*.ts"],
      }),
    );
    // `h` is not exported, so the second formula is refused at the gate.
    fs.writeFileSync(
      path.join(dir, "typo.ts"),
      "function h(x: number): number { return x; }\n" +
        "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x }\n" +
        " *  @ensures{bad} forall (x: int ∈ [0, 5)) { h(x) === x } */\n" +
        "export function f(x: number): number { return h(x); }\n",
    );
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a refused annotation is never tried, and says why", () => {
    const admission = admit(
      ["typo.ts"],
      path.join(dir, "tc.tsbuildinfo"),
      () => {},
    );
    if (admission.kind !== "admitted") throw new Error("not admitted");
    const [a] = writeEmissionArtifacts(admission.files, OUT, admission.refused);
    const written = JSON.parse(fs.readFileSync(a!.jsonFile!, "utf8"));
    expect(
      written.emission.obligations.map((o: { property: string }) => o.property),
    ).toEqual(["id"]);
    expect(written.annotations).toEqual([
      { function: "f", property: "id", line: 2, outcome: "tried" },
      {
        function: "f",
        property: "bad",
        line: 3,
        outcome: "refused",
        cause: "typing",
        error: expect.stringMatching(/^typo\.ts:3: /),
      },
    ]);
  });
});
