import { describe, it, expect } from "vitest";
import { runMain, useTempProject } from "./helpers/cli.js";

const ILL_TYPED = {
  "tsconfig.json": JSON.stringify({ include: ["src"] }),
  "src/abs.ts":
    "/** @ensures{nonNegative} forall (x: number ∈ (-∞, ∞)) { 0 <= abs(x) } */\n" +
    "export function abs(x: number): number {\n" +
    '  return "not a number at all";\n' +
    "}\n",
};

describe("thales refuses an ill-typed program", () => {
  useTempProject("thales-gate-prove-", ILL_TYPED);

  it("never reaches the emitter: no arity checks, no Inappropriate", async () => {
    const run = await runMain([]);
    expect(run.code).toBe(2);
    const env = JSON.parse(run.stdout[0]!);
    expect(env.annotations).toHaveLength(1);
    expect(env.annotations[0]).toMatchObject({ szs: "InputError" });
    expect(run.stderr.join("\n")).not.toContain("emitted");
  });
});

describe("the project switches strict off", () => {
  useTempProject("thales-gate-loose-", {
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
    const run = await runMain([]);
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
