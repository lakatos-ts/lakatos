import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * One tsc for the whole run. Several suites exercise the *built* bins in
 * each package's dist/, and test files run in parallel: building per file
 * would have two tsc processes truncating and rewriting the same output
 * while a third suite reads or spawns it.
 *
 * A refute child runs under its own config and never reaches this file;
 * the cwd guard stays as a belt for any other vitest started inside the
 * tree.
 */
export default function setup(): void {
  if (realpathSync(process.cwd()) !== realpathSync(repoRoot)) return;
  execFileSync("npx", ["tsc", "-b", "tsconfig.json"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
