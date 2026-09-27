import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";
import { main } from "../src/cli.js";
import { runTests } from "../src/run.js";
import { RUN_ROOT } from "@lakatos/core/run-dir";

// An interrupted run still honors the output contract: one schema-valid
// envelope on stdout in which every annotation the engine was to evaluate
// reports User, and the documented exit 2. The engine is mocked at the
// same module seam cli-unhealthy uses, so no signal is sent
// here; interrupt-e2e.test.ts covers the real thing.
vi.mock("../src/run.js", () => ({ runTests: vi.fn() }));
const runTestsMock = vi.mocked(runTests);

describe("pabst on an interrupted run", () => {
  useTempProject("pabst-cli-interrupted-", {
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
    runTestsMock.mockReset();
    fs.rmSync(RUN_ROOT, { recursive: true, force: true });
  });

  it("every annotation User, one diagnostic, exit 2", async () => {
    runTestsMock.mockReturnValue({ kind: "interrupted", signal: "SIGINT" });
    const { code, stdout, stderr } = await runMain(["annotated.ts"]);
    expect(code).toBe(2);
    expect(stdout).toHaveLength(1);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(env.annotations).toEqual([
      {
        file: "annotated.ts",
        function: "annotated",
        property: "pos",
        szs: "User",
        reason: "the run was interrupted (SIGINT)",
      },
      {
        file: "annotated.ts",
        function: "twin",
        property: "same",
        szs: "User",
        reason: "the run was interrupted (SIGINT)",
      },
    ]);
    expect(stderr).toContain(
      "pabst: interrupted by SIGINT; reporting 2 annotations as User",
    );
  });

  it("counts the lone annotation in the singular", async () => {
    runTestsMock.mockReturnValue({ kind: "interrupted", signal: "SIGINT" });
    const { stderr } = await runMain(["lone.ts"]);
    expect(stderr).toContain(
      "pabst: interrupted by SIGINT; reporting 1 annotation as User",
    );
  });

  it("an interrupted run reports no test counts", async () => {
    runTestsMock.mockReturnValue({ kind: "interrupted", signal: "SIGTERM" });
    const { stdout } = await runMain(["annotated.ts"]);
    const env = JSON.parse(stdout[0]!);
    // The seed and the generated count were known before the engine ran;
    // passed/failed only a completed vitest could have told us.
    expect(env.generated).toBe(2);
    expect(Number.isInteger(env.seed)).toBe(true);
    expect(env.passed).toBeUndefined();
    expect(env.failed).toBeUndefined();
  });

  it("input errors keep their own status beside the User entries", async () => {
    runTestsMock.mockReturnValue({ kind: "interrupted", signal: "SIGHUP" });
    const { code, stdout } = await runMain(["annotated.ts", "invalid.ts"]);
    expect(code).toBe(2);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    const statuses = env.annotations.map(
      (a: { szs: string }) => a.szs,
    ) as string[];
    expect(statuses.filter((s) => s === "User")).toHaveLength(2);
    expect(statuses).toContain("InputError");
  });

  it("the envelope is printed while the guard still stands", async () => {
    // A user who presses Ctrl-C twice would otherwise kill lakatos in the
    // gap between the engine's death and the report — the very failure the
    // User status exists to prevent — so the guard must outlast the run.
    runTestsMock.mockReturnValue({ kind: "interrupted", signal: "SIGINT" });
    const outside = process.listenerCount("SIGINT");
    let atPrint = outside;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      atPrint = process.listenerCount("SIGINT");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["annotated.ts"])).toBe(2);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
    expect(atPrint).toBe(outside + 1);
    expect(process.listenerCount("SIGINT")).toBe(outside);
  });

  it("a signal that reached lakatos reports User even when the engine exited by status", async () => {
    // vitest catches SIGINT and exits 130 rather than dying of it, so the
    // child's death says nothing; the signal reached lakatos too, and that
    // is what the run reads.
    runTestsMock.mockImplementation(() => {
      process.kill(process.pid, "SIGINT");
      return { kind: "no-results", status: 130, stdout: "", stderr: "" };
    });
    const { code, stdout, stderr } = await runMain(["annotated.ts"]);
    expect(code).toBe(2);
    expect(stdout).toHaveLength(1);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(
      env.annotations.map((a: { szs: string; reason?: string }) => [
        a.szs,
        a.reason,
      ]),
    ).toEqual([
      ["User", "the run was interrupted (SIGINT)"],
      ["User", "the run was interrupted (SIGINT)"],
    ]);
    expect(stderr).toContain(
      "pabst: interrupted by SIGINT; reporting 2 annotations as User",
    );
    expect(stderr.join("\n")).not.toContain("error:");
  });

  it("the signal lakatos saw names the run, whichever one the engine died of", async () => {
    runTestsMock.mockImplementation(() => {
      process.kill(process.pid, "SIGINT");
      return { kind: "interrupted", signal: "SIGTERM" };
    });
    const { code, stderr } = await runMain(["lone.ts"]);
    expect(code).toBe(2);
    expect(stderr).toContain(
      "pabst: interrupted by SIGINT; reporting 1 annotation as User",
    );
  });
});
