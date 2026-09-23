import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Everything outside lemma/ — lemma's own tests may reach for internals. */
const TREES = [
  "src",
  "tests",
  "engines/pabst/src",
  "engines/pabst/tests",
  "engines/thales/frontend/src",
  "engines/thales/frontend/tests",
];

/** Anchored on `from`, so prose and `vi.mock` targets are not hits. Mocking a
 * lemma internal is fine — the seam is narrower than the barrel. */
const FROM_CLAUSE = /\bfrom\s+["']([^"']+)["']/g;

/** The one way in: the package, whose only export is the barrel. */
const PACKAGE = "@lakatos-ts/lemma";

function tsFiles(tree: string): string[] {
  return readdirSync(path.join(REPO, tree), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(tree, f));
}

describe("lemma's public surface", () => {
  it("is reached only by package name, and only the barrel", () => {
    const offenders: string[] = [];
    for (const tree of TREES) {
      for (const file of tsFiles(tree)) {
        const text = readFileSync(path.join(REPO, file), "utf8");
        for (const [, specifier] of text.matchAll(FROM_CLAUSE)) {
          const relative = /(?:^|\/)lemma\/(src|tests)\//.test(specifier!);
          const subpath = specifier!.startsWith(`${PACKAGE}/`);
          if (relative || subpath) offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      `these reach lemma by a relative path or a subpath; import "${PACKAGE}" ` +
        "instead, adding the name to the barrel if it belongs in lemma's " +
        "public surface",
    ).toEqual([]);
  });
});
