import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Each package's code reads only its own files, so a fresh clone of its
// own repo has everything it opens. Comments are prose and may name others.

const root = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["lemma", "pabst", "thales"];
const SKIP = new Set([
  "node_modules",
  ".lake",
  "dist",
  "test262",
  "fixtures",
  "conformance",
]);
const CODE = /\.(ts|js|mjs|lean|sh)$/;

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files(full, out);
    else if (CODE.test(e.name)) out.push(full);
  }
  return out;
}

describe("each package reads only its own files", () => {
  for (const pkg of PACKAGES) {
    it(pkg, () => {
      const pkgDir = path.join(root, pkg);
      // lemma's own spec/ is the language spec; anyone else's is the umbrella's.
      const others = [
        ...PACKAGES.filter((p) => p !== pkg),
        "core",
        ...(pkg === "lemma" ? [] : ["spec"]),
      ].join("|");
      // A repo-relative string under another package, a path segment naming
      // one, or a shell `cd ..` out of the package.
      const named = new RegExp(
        `["'](${others})/|(join|resolve)\\([^)]*["'](${others})["']|^\\s*["'](${others})["'],|\\bcd \\.\\.(\\s|\\)|$)`,
      );
      // A relative path that climbs out of the package. Lean runs from the
      // package root; everything else resolves against its own file.
      const climbsOut = (f: string, line: string): boolean =>
        [...line.matchAll(/(?:\.\.\/)+(?:\.\.|[\w.-]+)?(?=["'`/)])/g)].some(
          ([rel]) => {
            const from = f.endsWith(".lean") ? pkgDir : path.dirname(f);
            const to = path.resolve(from, rel);
            return to !== pkgDir && !to.startsWith(pkgDir + path.sep);
          },
        );
      const hits = files(pkgDir).flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [line, i] as const)
          .filter(
            ([line]) =>
              (named.test(line) || climbsOut(f, line)) &&
              !/^\s*(\/\/|\*|\/\*|--|#)/.test(line),
          )
          .map(
            ([line, i]) => `${path.relative(root, f)}:${i + 1}: ${line.trim()}`,
          ),
      );
      expect(hits).toEqual([]);
    });
  }
});
