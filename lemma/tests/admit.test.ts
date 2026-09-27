import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import { admit, refusalsOf, type Note } from "../src/admit.js";
import { LemmaError } from "../src/errors.js";
import { useTempProject } from "./helpers/temp-project.js";

const cache = (): string =>
  path.join(os.tmpdir(), `admit-cache-${process.pid}-${Math.random()}`);

/** Admit, collecting the notes it streams. */
function admitted(patterns: string[]) {
  const notes: Note[] = [];
  const a = admit(patterns, cache(), (n) => notes.push(n));
  return { ...a, notes };
}

const GOOD = `/** @ensures{p} forall (n: int) { f(n) === n } */\nexport function f(n: number): number { return n; }\n`;

describe("refusalsOf", () => {
  it("prefixes each diagnostic with file:line and qualifies the name", () => {
    expect(
      refusalsOf("a.ts", [
        {
          propertyName: "p",
          functionName: "id",
          className: "Box",
          isStatic: true,
          line: 3,
          message: "bad",
        },
      ]),
    ).toEqual([
      { file: "a.ts", function: "Box.id", property: "p", error: "a.ts:3: bad" },
    ]);
  });
});

describe("admit without a tsconfig", () => {
  useTempProject("admit-missing-", { "a.ts": GOOD }, { tsconfig: false });

  it("refuses every annotation and says why", () => {
    const a = admitted(["a.ts"]);
    expect(a.kind).toBe("refused");
    expect(a.refusals).toEqual([
      {
        file: "a.ts",
        function: "f",
        property: "p",
        error: expect.stringMatching(/^no tsconfig\.json: /),
      },
    ]);
    expect(a.notes).toEqual([
      {
        level: "info",
        text: "no tsconfig.json; reporting 1 annotation as InputError",
      },
    ]);
  });
});

describe("admit over an ill-typed program", () => {
  useTempProject("admit-failed-", {
    "a.ts": GOOD,
    "b.ts": `export const x: number = "no";\n`,
  });

  it("echoes the diagnostic, then counts the refusals", () => {
    const a = admitted([]);
    expect(a.kind).toBe("refused");
    expect(a.notes[0]).toEqual({
      level: "info",
      text: "no files given; discovered 2 file(s) via tsconfig.json",
    });
    expect(a.notes[1]).toMatchObject({
      level: "error",
      text: expect.stringMatching(/^b\.ts:1: TS2322: /),
    });
    expect(a.notes.at(-1)).toEqual({
      level: "info",
      text: "the program does not type check under lakatos's required options; reporting 1 annotation as InputError",
    });
  });
});

describe("admit with a named file outside the program", () => {
  useTempProject("admit-outside-", {
    "a.ts": GOOD,
    "extra/b.ts": `/** @ensures{p} forall (n: int) { g(n) === n } */\nexport function g(n: number): number { return n; }\n`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "es2022", module: "nodenext", types: [] },
      include: ["a.ts"],
    }),
  });

  it("refuses only that file and admits the rest", () => {
    const a = admitted(["a.ts", "extra/b.ts"]);
    expect(a.kind).toBe("admitted");
    if (a.kind !== "admitted") return;
    expect(a.files).toEqual(["a.ts"]);
    const outside =
      "extra/b.ts is not part of the program tsconfig.json describes, so it was not type checked";
    expect(a.refusals).toEqual([
      { file: "extra/b.ts", function: "g", property: "p", error: outside },
    ]);
    expect(a.notes).toEqual([{ level: "error", text: outside }]);
  });
});

describe("admit over an unreadable formula", () => {
  useTempProject("admit-unreadable-", {
    "a.ts": `/** @ensures{p} forall (n: int) { forall (m: int) { f(n) === m } } */\nexport function f(n: number): number { return n; }\n`,
  });

  it("has already noted discovery when it throws", () => {
    const notes: Note[] = [];
    expect(() => admit([], cache(), (n) => notes.push(n))).toThrow(LemmaError);
    expect(notes).toEqual([
      {
        level: "info",
        text: "no files given; discovered 1 file(s) via tsconfig.json",
      },
    ]);
  });

  it("throws a LemmaError naming the annotation", () => {
    expect(() => admitted(["a.ts"])).toThrow(LemmaError);
    expect(() => admitted(["a.ts"])).toThrow(/^a\.ts:1: @ensures\{p\}: /);
  });
});
