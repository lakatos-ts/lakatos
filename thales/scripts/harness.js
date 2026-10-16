// Shared scaffolding for the engine's check scripts: where the engine and
// its binary live, failure collection, and the exit protocol.

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const engineRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repoRoot = path.resolve(engineRoot, "..");

/** The Lean binary, built: the checks run what the tool runs. */
export function thalesBinary() {
  const r = spawnSync("lake", ["build", "thales"], {
    cwd: engineRoot,
    encoding: "utf8",
    timeout: 600_000,
  });
  if (r.status !== 0) {
    console.error(
      `lake build thales failed (${r.status}):\n${r.stderr ?? r.error}`,
    );
    process.exit(1);
  }
  return path.join(engineRoot, ".lake", "build", "bin", "thales");
}

/** This checkout's lemma, built by the root build; the binary reaches it
 * through LAKATOS_LEMMA. */
export const lemmaDir = path.join(repoRoot, "lemma");

/** JSON text with every object's keys sorted, at every depth: equality
 * of envelopes is equality of values, never of key order. */
export function canonical(value) {
  return JSON.stringify(value, (_, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
}

/** Collects failures rather than throwing, so one run surfaces every
 * violation instead of stopping at the first. */
export function checker(label) {
  const failures = [];
  return {
    check(cond, message) {
      if (!cond) failures.push(message);
    },
    failed() {
      return failures.length > 0;
    },
    done(summary) {
      if (failures.length > 0) {
        console.error(`${label} check FAILED:`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
      }
      console.log(`${label} check passed (${summary})`);
    },
  };
}
