import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  runForEnvelope,
  runMain,
  useRepoScratchDir,
  useTempProject,
} from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";

const SIBLING =
  "/** @ensures{bad} forall (x: int ∈ [0, 5)) { f(x) } */\n" +
  "/** @ensures{good} forall (x: int ∈ [0, 5)) { f(x) >= 0 } */\n" +
  "export function f(x: number): number { return x; }\n";

const BAD_ATOM =
  "sibling.ts:1: @ensures{bad}: in atom `f(x)`: TS1360: Type 'number' does not satisfy the expected type 'boolean'.";

// The gate refuses the annotation before pabst sees it; the prover's suite
// sweeps every kind of atom fault, so one witness suffices here.
describe("pabst refuses a type fault inside an atom", () => {
  useTempProject("pabst-island-", {
    "j.ts":
      "export function scale(x: number, factor: number): number {\n" +
      "  return x * factor;\n" +
      "}\n" +
      "/** @ensures{p} forall (x: int ∈ [0, 5)) { scale(x) >= 0 } */\n" +
      "export function id(x: number): number {\n  return x;\n}\n",
  });

  it("j.ts reports InputError naming the atom and exits 2", async () => {
    const error =
      "j.ts:4: @ensures{p}: in atom `scale(x) >= 0`: TS2554: Expected 2 arguments, but got 1.";
    const { code, stdout, stderr } = await runMain(["j.ts"]);
    expect(code).toBe(2);
    expect(stdout).toHaveLength(1);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(env.annotations).toEqual([
      { file: "j.ts", function: "id", property: "p", szs: "InputError", error },
    ]);
    expect(stderr).toContain(`error: ${error}`);
    // No engine saw the annotation: pabst generated nothing.
    expect(stderr.join("\n")).toMatch(/generated 0 properties/);
  });
});

describe("pabst: a sound sibling of a faulty annotation still runs", () => {
  const repoRoot = process.cwd();
  useRepoScratchDir(
    path.join(repoRoot, ".lakatos", "island-sibling"),
    (dir) => {
      fs.writeFileSync(path.join(dir, "sibling.ts"), SIBLING, "utf8");
    },
  );

  it(
    "gets its verdict beside the InputError, exit 2",
    { timeout: 60000 },
    async () => {
      const env = await runForEnvelope(["sibling.ts"], 2);
      expect(env).toMatchObject({ generated: 1, passed: 1, failed: 0 });
      expect(env.annotations).toEqual([
        {
          file: "sibling.ts",
          function: "f",
          property: "good",
          szs: "Theorem",
          kind: "enumerated",
          cases: 5,
        },
        {
          file: "sibling.ts",
          function: "f",
          property: "bad",
          szs: "InputError",
          error: BAD_ATOM,
        },
      ]);
    },
  );
});
