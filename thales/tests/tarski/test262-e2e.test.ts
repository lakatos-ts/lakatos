import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { BUILD_TIMEOUT_MS, ensureBinary, PACKAGE } from "./helpers/binary.js";

// What ties the fake binary to the real one. The runner's Lean tests run
// `Test/fixtures/fake-tarski.sh`, whose exit codes and stderr lines
// transcribe `Tarski/Main.lean`'s contract; this run puts the real binary
// in its place over the same tree and demands the same table. It needs the
// Lean toolchain, so it runs under LAKATOS_TARSKI_E2E=1 in `lean.yml`.
const TREE = path.join(PACKAGE, "Test", "fixtures", "test262");
const FAKE = path.join(PACKAGE, "Test", "fixtures", "fake-tarski.sh");

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

let runner = "";

const run = (binary: string): Run => {
  const r = spawnSync(
    runner,
    ["test", "--test262", TREE, "--binary", binary, "--timeout", "2000"],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe.runIf(process.env.LAKATOS_TARSKI_E2E === "1")(
  "the built runner over the fake tree",
  () => {
    // Two runs of the whole tree, each paying the timeout test once.
    let real: Run;
    let fake: Run;
    beforeAll(
      () => {
        const evaluator = ensureBinary("tarski");
        const built = ensureBinary("tarski-test262");
        expect(evaluator.kind, JSON.stringify(evaluator)).toBe("ready");
        expect(built.kind, JSON.stringify(built)).toBe("ready");
        if (evaluator.kind !== "ready" || built.kind !== "ready") return;
        runner = built.binary;
        real = run(evaluator.binary);
        fake = run(FAKE);
      },
      2 * BUILD_TIMEOUT_MS + 60_000,
    );

    it("produces exactly the table the fake binary does", () => {
      expect(real.status, real.stderr).toBe(0);
      expect(real.stdout).toBe(fake.stdout);
    });

    it("passes the tests the fake tree says pass", () => {
      expect(real.stdout).toContain(
        "test/pass              6     0            0        0              0        0",
      );
    });

    it("refuses a $262 hook as unsupported rather than failing it", () => {
      expect(real.stdout).toContain("$262.evalScript  1");
    });
  },
);
