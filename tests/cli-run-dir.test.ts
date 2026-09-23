import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runDirFor } from "@lakatos-ts/core/run-dir";
import { DEFAULT_TSCONFIG, runMain } from "./helpers/cli.js";

// Run directories are named in UTC, whatever the machine is set to: two
// people looking at the same run must read the same directory name, and the
// name must mean the same instant as the envelope's startedAt.
describe("run directory naming is UTC", () => {
  const prevTz = process.env.TZ;
  const prevCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakatos-run-dir-tz-"));

  afterAll(() => {
    process.env.TZ = prevTz;
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stamps the instant in UTC under a machine that is not", async () => {
    fs.writeFileSync(path.join(dir, "plain.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), DEFAULT_TSCONFIG);
    process.env.TZ = "Asia/Kolkata";
    process.chdir(dir);
    const { stdout } = await runMain(["check", "plain.ts"]);
    const startedAt = JSON.parse(stdout[0]!).startedAt as string;
    // Zulu, not a local offset: no +05:30 may reach either the report or
    // the directory name derived from it.
    expect(startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(runDirFor(startedAt)).toMatch(/Z$/);
  });
});

// Nothing a run writes may land on top of an earlier run's artifacts. Two
// invocations starting in the same millisecond want the same name, which is
// ordinary in a shell loop: the second one steps aside instead of failing.
describe("a run directory whose name is taken", () => {
  const prevCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakatos-run-dir-clash-"));

  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("takes the next free name, leaving the occupant untouched", async () => {
    fs.writeFileSync(path.join(dir, "plain.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), DEFAULT_TSCONFIG);
    process.chdir(dir);
    // A frozen clock makes the collision reachable: every run computes the
    // same name, exactly as same-millisecond invocations do.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-25T06:35:35.943Z"));
    const taken = runDirFor(new Date().toISOString());
    fs.mkdirSync(taken, { recursive: true });
    fs.writeFileSync(path.join(taken, "keep.txt"), "earlier run\n");

    const { stderr } = await runMain(["check", "plain.ts"]);
    expect(fs.existsSync(`${taken}-2`)).toBe(true);
    // The occupant is exactly as it was, and nothing was reported as wrong.
    expect(fs.readFileSync(path.join(taken, "keep.txt"), "utf8")).toBe(
      "earlier run\n",
    );
    expect(stderr.join("\n")).not.toContain("error:");

    // And again: the counter walks on rather than settling on one alias.
    await runMain(["check", "plain.ts"]);
    expect(fs.existsSync(`${taken}-3`)).toBe(true);
  });
});

// Checking the name and then creating it later would leave a window in which
// two runs both see it free. Claiming it means creating it: the directory is
// there from the moment the run starts, even for a run that goes on to
// generate nothing.
describe("claiming a run directory reserves the name", () => {
  const prevCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakatos-run-dir-claim-"));

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates the directory before the engine writes anything", async () => {
    fs.writeFileSync(path.join(dir, "plain.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), DEFAULT_TSCONFIG);
    process.chdir(dir);
    const { stdout } = await runMain(["check", "plain.ts"]);
    const startedAt = JSON.parse(stdout[0]!).startedAt as string;
    expect(fs.existsSync(runDirFor(startedAt))).toBe(true);
  });
});
