import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";
import { runEmission } from "../thales/frontend/src/run.js";
import { RUN_ROOT } from "@lakatos/core/run-dir";

// An interrupted run still honors the output contract: one schema-valid
// envelope on stdout in which every annotation the engine was to evaluate
// reports User, and the documented exit 2. The prover is mocked at the
// module seam cli-prove uses, so no signal is sent here; pabst's
// interrupt-e2e.test.ts covers the real thing.
vi.mock("../thales/frontend/src/run.js", () => ({
  runEmission: vi.fn(),
  findEngineRoot: vi.fn(),
}));
const runEmissionMock = vi.mocked(runEmission);

describe("cli on an interrupted run", () => {
  useTempProject("lakatos-cli-interrupted-", {
    "annotated.ts": [
      "/** @ensures{pos} forall (n: int ∈ [0, 5)) { annotated(n) >= 0 } */",
      "export function annotated(n: number): number { return n; }",
      "",
      "/** @ensures{same} forall (n: int ∈ [0, 5)) { twin(n) === n } */",
      "export function twin(n: number): number { return n; }",
      "",
    ].join("\n"),
    "lone.ts": [
      "/** @ensures{pos} forall (n: int ∈ [0, 5)) { lone(n) >= 0 } */",
      "export function lone(n: number): number { return n; }",
      "",
    ].join("\n"),
    "invalid.ts": [
      "class Hidden {",
      "  /** @ensures{p} forall (x: int ∈ [0, 5)) { id(x) === x } */",
      "  static id(x: number): number { return x; }",
      "}",
      "",
    ].join("\n"),
  });

  afterEach(() => {
    runEmissionMock.mockReset();
    fs.rmSync(RUN_ROOT, { recursive: true, force: true });
  });

  it("prove: a signal that reached lakatos outranks a completed Lean run", async () => {
    runEmissionMock.mockImplementation(() => {
      process.kill(process.pid, "SIGTERM");
      return { kind: "failed", stdout: "", stderr: "" };
    });
    const { code, stdout, stderr } = await runMain(["prove", "annotated.ts"]);
    expect(code).toBe(2);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(
      env.annotations.every((a: { szs: string }) => a.szs === "User"),
    ).toBe(true);
    expect(stderr).toContain(
      "thales: interrupted by SIGTERM; reporting 2 annotations as User",
    );
  });

  it("prove: the same contract through the Lean runner", async () => {
    runEmissionMock.mockReturnValue({ kind: "interrupted", signal: "SIGINT" });
    const { code, stdout, stderr } = await runMain(["prove", "annotated.ts"]);
    expect(code).toBe(2);
    expect(stdout).toHaveLength(1);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(
      env.annotations.every((a: { szs: string }) => a.szs === "User"),
    ).toBe(true);
    expect(stderr).toContain(
      "thales: interrupted by SIGINT; reporting 2 annotations as User",
    );
  });
});
