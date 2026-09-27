import { describe, it, expect } from "vitest";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";

const SCALE =
  "export function scale(x: number, factor: number): number {\n" +
  "  return x * factor;\n" +
  "}\n";

const REPROS = {
  "j.ts":
    SCALE +
    "/** @ensures{p} forall (x: int ∈ [0, 5)) { scale(x) >= 0 } */\n" +
    "export function id(x: number): number {\n  return x;\n}\n",
  "q.ts":
    "/** @ensures{p} forall (x: int ∈ [0, 5)) { f(x) + q >= 0 } */\n" +
    "export function f(x: number): number {\n  return x;\n}\n",
  "b.ts":
    "/** @ensures{p} forall (x: int ∈ [0, 5)) { h(x) } */\n" +
    "export function h(x: number): number {\n  return x;\n}\n",
  "hidden.ts":
    "function g(x: number): number { return x; }\n" +
    "/** @ensures{p} forall (x: int ∈ [0, 5)) { g(x) > 0 } */\n" +
    "export function f(x: number): number { return x; }\n",
  "sibling.ts":
    "/** @ensures{bad} forall (x: int ∈ [0, 5)) { f(x) } */\n" +
    "/** @ensures{good} forall (x: int ∈ [0, 5)) { f(x) >= 0 } */\n" +
    "export function f(x: number): number { return x; }\n",
};

const EXPECTED = {
  "j.ts": {
    function: "id",
    error:
      "j.ts:4: @ensures{p}: in atom `scale(x) >= 0`: TS2554: Expected 2 arguments, but got 1.",
  },
  "q.ts": {
    function: "f",
    error:
      "q.ts:1: @ensures{p}: in atom `f(x) + q >= 0`: TS2304: Cannot find name 'q'.",
  },
  "b.ts": {
    function: "h",
    error:
      "b.ts:1: @ensures{p}: in atom `h(x)`: TS1360: Type 'number' does not satisfy the expected type 'boolean'.",
  },
  "hidden.ts": {
    function: "f",
    error:
      "hidden.ts:2: @ensures{p}: in atom `g(x) > 0`: 'g' is not exported from hidden.ts; " +
      "a formula may name only the module's exports and the host's standard globals",
  },
} as const;

async function expectIslandRefusal(file: keyof typeof EXPECTED): Promise<void> {
  const { code, stdout, stderr } = await runMain([file]);
  expect(code).toBe(2);
  expect(stdout).toHaveLength(1);
  const env = JSON.parse(stdout[0]!);
  expectValidEnvelope(env);
  expect(env.annotations).toEqual([
    {
      file,
      function: EXPECTED[file].function,
      property: "p",
      szs: "InputError",
      error: EXPECTED[file].error,
    },
  ]);
  expect(stderr).toContain(`error: ${EXPECTED[file].error}`);
  // No engine saw the annotation: the spine counts nothing to run.
  expect(stderr.join("\n")).toContain("emitted 0 annotations");
}

describe("a type fault inside an atom is the annotation's InputError", () => {
  useTempProject("thales-island-", REPROS);

  it.each(Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>)(
    "%s reports InputError naming the atom and exits 2",
    async (file) => {
      await expectIslandRefusal(file);
    },
  );
});
