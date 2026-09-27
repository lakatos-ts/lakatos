import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";

const ILL_TYPED = {
  "tsconfig.json": JSON.stringify({ include: ["src"] }),
  "src/abs.ts":
    "/** @ensures{nonNegative} forall (x: number ∈ (-∞, ∞)) { 0 <= abs(x) } */\n" +
    "export function abs(x: number): number {\n" +
    '  return "not a number at all";\n' +
    "}\n",
};

describe("prove refuses the same program the same way", () => {
  useTempProject("lakatos-gate-prove-", ILL_TYPED);

  it("never reaches the emitter: no arity checks, no Inappropriate", async () => {
    const run = await runMain(["prove"]);
    expect(run.code).toBe(2);
    const env = JSON.parse(run.stdout[0]!);
    expect(env.annotations).toHaveLength(1);
    expect(env.annotations[0]).toMatchObject({ szs: "InputError" });
    expect(run.stderr.join("\n")).not.toContain("emitted");
  });
});

describe("a tsconfig that names no files", () => {
  useTempProject("lakatos-gate-noinputs-", {
    "tsconfig.json": JSON.stringify({ files: [] }),
    "src/a.ts":
      "/** @ensures{pos} forall (n: nat) { id(n) >= 0 } */\n" +
      "export function id(n: number): number {\n  return n;\n}\n",
  });

  it("stops at discovery without scanning src/", async () => {
    const run = await runMain(["check"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toEqual([
      'error: tsconfig.json names no files; pass files or globs (e.g. lakatos refute "src/**/*.ts")',
    ]);
    expect(run.stdout).toHaveLength(0);
  });

  it("still refuses a named file the program leaves out", async () => {
    const run = await runMain(["check", "src/a.ts"]);
    expect(run.code).toBe(2);
    expect(run.stderr.join("\n")).toContain(
      "error: src/a.ts is not part of the program tsconfig.json describes",
    );
    const env = JSON.parse(run.stdout[0]!);
    expect(env.annotations).toEqual([
      expect.objectContaining({
        function: "id",
        szs: "InputError",
        error:
          "src/a.ts is not part of the program tsconfig.json describes, so it was not type checked",
      }),
    ]);
  });
});

describe("no tsconfig: the run is refused", () => {
  useTempProject(
    "lakatos-gate-missing-",
    {
      "src/a.ts":
        "/** @ensures{pos} forall (n: nat) { id(n) >= 0 } */\n" +
        "export function id(n: number): number {\n  return n;\n}\n",
      "src/b.ts":
        "/** @ensures{pos} forall (n: nat) { other(n) >= 0 } */\n" +
        "export function other(n: number): number {\n  return n;\n}\n",
    },
    { tsconfig: false },
  );

  it("reports every annotation InputError and exits 2", async () => {
    const run = await runMain(["check", "src/a.ts", "src/b.ts"]);
    expect(run.code).toBe(2);
    expect(run.stderr.join("\n")).toContain(
      "lakatos: no tsconfig.json; reporting 2 annotations as InputError",
    );
    const env = JSON.parse(run.stdout[0]!);
    expectValidEnvelope(env);
    const error =
      "no tsconfig.json: lakatos type checks the program before analyzing it and needs the project's compiler options to do so";
    expect(env.annotations).toEqual([
      {
        file: "src/a.ts",
        function: "id",
        property: "pos",
        szs: "InputError",
        error,
      },
      {
        file: "src/b.ts",
        function: "other",
        property: "pos",
        szs: "InputError",
        error,
      },
    ]);
    expect(fs.existsSync(".lakatos")).toBe(false);
  });
});

describe("a named file outside the program", () => {
  useTempProject("lakatos-gate-outside-", {
    "tsconfig.json": JSON.stringify({ include: ["src"] }),
    "src/a.ts":
      "/** @ensures{pos} forall (n: nat) { id(n) >= 0 } */\n" +
      "export function id(n: number): number {\n  return n;\n}\n",
    "extra/b.ts":
      "/** @ensures{pos} forall (n: nat) { other(n) >= 0 } */\n" +
      "export function other(n: number): number {\n  return n;\n}\n",
  });

  it("refuses only that file's annotations and still runs the rest", async () => {
    const run = await runMain(["check", "src/a.ts", "extra/b.ts"]);
    expect(run.code).toBe(2);
    const env = JSON.parse(run.stdout[0]!);
    const byFile = Object.fromEntries(
      env.annotations.map((a: { file: string; szs: string }) => [
        a.file,
        a.szs,
      ]),
    );
    expect(byFile).toEqual({
      "src/a.ts": "NotTried",
      "extra/b.ts": "InputError",
    });
  });
});

describe("the project switches strict off", () => {
  useTempProject("lakatos-gate-loose-", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: false },
      include: ["src"],
    }),
    "src/a.ts":
      "/** @ensures{nonNeg} forall (x: int ∈ [0, 5)) { f(x) >= 0 } */\n" +
      "export function f(x: number): number {\n" +
      "  const y: number = undefined;\n" +
      "  return x + y;\n}\n",
  });

  it("is checked under lakatos's required options regardless", async () => {
    const run = await runMain(["prove"]);
    expect(run.code).toBe(2);
    expect(run.stderr.join("\n")).toContain(
      "error: src/a.ts:3: TS2322: Type 'undefined' is not assignable to type 'number'.",
    );
    expect(run.stderr.join("\n")).toContain(
      "thales: the program does not type check under lakatos's required options; reporting 1 annotation as InputError",
    );
    expect(JSON.parse(run.stdout[0]!).annotations[0]).toMatchObject({
      szs: "InputError",
    });
  });
});

describe("clean project under a tsconfig: no warning, no refusal", () => {
  useTempProject("lakatos-gate-clean-", {
    "tsconfig.json": JSON.stringify({ include: ["src"] }),
    "src/a.ts":
      "/** @ensures{pos} forall (n: nat) { id(n) >= 0 } */\n" +
      "export function id(n: number): number {\n  return n;\n}\n",
  });

  it("says nothing about it, and leaves its build info for the next run", async () => {
    const run = await runMain(["check"]);
    expect(run.code).toBe(1);
    expect(run.stderr.join("\n")).not.toContain("type check");
    expect(fs.existsSync(path.join(".lakatos", "typecheck.tsbuildinfo"))).toBe(
      true,
    );
  });
});
