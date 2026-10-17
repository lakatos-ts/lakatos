// The two Lean executables as test dependencies: build one and say where it
// landed. A cached `lake build` is a fast no-op, and a binary built from
// another checkout would run some other semantics than this tree defines.

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The `thales/` lake package. */
export const PACKAGE = fileURLToPath(new URL("../../..", import.meta.url));

/** The budget one `lake build` gets. */
export const BUILD_TIMEOUT_MS = 600_000;

export type BinaryResult =
  | { kind: "ready"; binary: string }
  /** The build failed; both streams are the diagnosis. */
  | { kind: "failed"; stdout: string; stderr: string };

export function ensureBinary(
  target: "tarski" | "tarski-test262" = "tarski",
): BinaryResult {
  const build = spawnSync("lake", ["build", target], {
    cwd: PACKAGE,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });
  if (build.error !== undefined || build.status !== 0) {
    return {
      kind: "failed",
      // A spawn that never started answers with both streams null.
      stdout: build.stdout ?? "",
      stderr:
        (build.stderr ?? "") + (build.error ? `${String(build.error)}\n` : ""),
    };
  }
  return {
    kind: "ready",
    binary: path.join(PACKAGE, ".lake", "build", "bin", target),
  };
}
