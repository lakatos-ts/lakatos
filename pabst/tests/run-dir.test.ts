import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  claimRunDir,
  MAX_CLAIM_ATTEMPTS,
  runDirFor,
  RunDirError,
} from "../src/run-dir.js";

describe("runDirFor", () => {
  it("roots the run at .lakatos, named by the run's start instant", () => {
    expect(runDirFor("2026-08-25T06:35:35.943Z")).toBe(
      ".lakatos/2026-08-25T06-35-35.943Z",
    );
  });

  // A directory named with colons is illegal on Windows and awkward to type
  // in a shell; hyphens keep the name sortable and readable.
  it("carries no colons into the directory name", () => {
    expect(runDirFor("2026-08-25T06:35:35.943Z")).not.toContain(":");
  });

  // Successive runs must not collide: the envelope's startedAt is
  // millisecond-resolution, and the directory name keeps every digit.
  it("distinguishes runs a millisecond apart", () => {
    expect(runDirFor("2026-08-25T06:35:35.943Z")).not.toBe(
      runDirFor("2026-08-25T06:35:35.944Z"),
    );
  });
});

// Stepping over an occupied name must not become an unbounded scan, and a
// filesystem failure that is not a name collision is not this function's to
// interpret: it belongs to whoever can act on it.
describe("claimRunDir failure modes", () => {
  const prevCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lakatos-run-dir-fail-"));

  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("gives up once every name it would try is taken", () => {
    process.chdir(dir);
    const startedAt = "2026-08-25T06:35:35.943Z";
    const base = runDirFor(startedAt);
    fs.mkdirSync(base, { recursive: true });
    for (let n = 2; n <= MAX_CLAIM_ATTEMPTS; n++) fs.mkdirSync(`${base}-${n}`);
    expect(() => claimRunDir(startedAt)).toThrow(RunDirError);
  });

  it("lets a failure that is not a collision through unchanged", () => {
    process.chdir(dir);
    // Too long for any filesystem: mkdir fails for a reason retrying cannot
    // fix, so the error reaches the caller as the system reported it.
    let caught: unknown;
    try {
      claimRunDir("x".repeat(300));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(RunDirError);
    expect((caught as NodeJS.ErrnoException).code).toBe("ENAMETOOLONG");
  });
});
