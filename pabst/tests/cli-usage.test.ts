import { describe, it, expect } from "vitest";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";
import { COMPILE_ERROR_CASES } from "./helpers/compile-error-cases.js";

describe("pabst usage errors", () => {
  it("returns 2 on a non-integer --seed", async () => {
    expect((await runMain(["--seed", "4.2", "baz.ts"])).code).toBe(2);
  });

  it("returns 2 on an out-of-range --seed", async () => {
    expect((await runMain(["--seed", String(2 ** 32), "baz.ts"])).code).toBe(2);
  });
});

describe("pabst input errors", () => {
  useTempProject("pabst-cli-inputerror-", {
    "dup.ts": `/**
 * @ensures{d} forall (x: int) { f(x) === x }
 * @ensures{d} forall (x: int) { f(x) === x }
 */
export function f(x: number): number { return x; }
`,
  });

  it("a run with only input errors keeps the contract and exits 2", async () => {
    const { code, stdout, stderr } = await runMain(["dup.ts"]);
    expect(code).toBe(2);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(env.annotations).toHaveLength(1);
    expect(env.annotations[0]).toEqual({
      file: "dup.ts",
      function: "f",
      property: "d",
      szs: "InputError",
      error: expect.stringMatching(/^dup\.ts:2: duplicate property name 'd'/),
    });
    expect(stderr.join("\n")).toContain(
      "dup.ts:2: duplicate property name 'd'",
    );
  });
});

describe("pabst compile errors (exit-code contract)", () => {
  useTempProject(
    "pabst-cli-err-",
    Object.fromEntries(COMPILE_ERROR_CASES.map((c) => [c.file, c.source])),
  );

  it.each(COMPILE_ERROR_CASES)(
    "$name exits 2 with a one-line diagnostic",
    async (c) => {
      const { code, stderr } = await runMain([c.file]);
      expect(code).toBe(2);
      const diagnostics = stderr;
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).not.toContain("\n");
      if (c.wrapped) {
        expect(diagnostics[0]).toContain(
          `${c.file}:1: @ensures{${c.property}}:`,
        );
      }
      for (const fragment of c.expected) {
        expect(diagnostics[0]).toContain(fragment);
      }
    },
  );
});
