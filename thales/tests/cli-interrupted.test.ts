import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  enabled,
  fakeLake,
  proveTimeoutMs,
  runMain,
  useTempProject,
} from "./helpers/cli.js";

// An interrupted run still honors the output contract: one schema-valid
// envelope on stdout in which every annotation the engine was to evaluate
// reports User, and the documented exit 2. The signal kills the engine's
// child, not thales; pabst's interrupt-e2e.test.ts covers a signal that
// reaches the parent.
describe.runIf(enabled)("thales on an interrupted run", () => {
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
  });

  it(
    "prove: an engine child that dies of SIGINT makes the run User, exit 2, and no later artifact runs",
    async () => {
      const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-ran-"));
      const log = path.join(logDir, "ran");
      try {
        const env = fakeLake(`basename "$ARTIFACT" >> '${log}'\nkill -INT $$`);
        const { code, stdout, stderr } = await runMain(
          ["annotated.ts", "lone.ts"],
          env,
        );
        expect(code).toBe(2);
        expect(stdout).toHaveLength(1);
        const envelope = JSON.parse(stdout[0]!);
        expect(envelope.annotations).toHaveLength(3);
        expect(
          envelope.annotations.every((a: { szs: string }) => a.szs === "User"),
        ).toBe(true);
        expect(stderr).toContain(
          "thales: interrupted by SIGINT; reporting 3 annotations as User",
        );
        expect(fs.readFileSync(log, "utf8")).toBe("annotated.ts.lean\n");
      } finally {
        fs.rmSync(logDir, { recursive: true, force: true });
      }
    },
    proveTimeoutMs(2),
  );

  it(
    "prove: SIGTERM is reported by name",
    async () => {
      const env = fakeLake(`kill -TERM $$`);
      const { code, stderr } = await runMain(["annotated.ts"], env);
      expect(code).toBe(2);
      expect(stderr).toContain(
        "thales: interrupted by SIGTERM; reporting 2 annotations as User",
      );
    },
    proveTimeoutMs(1),
  );
});
