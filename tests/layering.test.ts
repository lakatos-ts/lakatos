import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The package sources and the directories each may not import from. */
const PACKAGES: { dir: string; forbidden: string[] }[] = [
  { dir: "core/src", forbidden: ["src", "lemma", "engines", "tarski"] },
  { dir: "lemma/src", forbidden: ["src", "engines", "tarski"] },
  {
    dir: "lemma/tests",
    forbidden: ["src", "tests", "core", "engines", "tarski"],
  },
  { dir: "src", forbidden: ["core", "lemma"] },
  { dir: "engines/pabst/src", forbidden: ["src", "lemma", "engines/thales"] },
  {
    dir: "engines/thales/frontend/src",
    forbidden: ["src", "lemma", "engines/pabst"],
  },
  { dir: "tarski/frontend/src", forbidden: ["src", "lemma", "engines"] },
];

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .map((f) => path.join(dir, f));
}

/** Every relative module specifier in a file, resolved against the file. */
function relativeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specifiers = [
    ...text.matchAll(/\bfrom\s+"(\.[^"]*)"/g),
    ...text.matchAll(/\bimport\s+"(\.[^"]*)"/g),
    ...text.matchAll(/\bimport\(\s*"(\.[^"]*)"\s*\)/g),
  ].map((m) => m[1]!);
  return specifiers.map((s) => path.resolve(path.dirname(file), s));
}

describe("import layering", () => {
  for (const { dir, forbidden } of PACKAGES) {
    it(`${dir} imports nothing from ${forbidden.join(", ")}`, () => {
      const violations: string[] = [];
      for (const file of tsFiles(path.join(root, dir))) {
        for (const target of relativeImports(file)) {
          const rel = path.relative(root, target);
          const hit = forbidden.find(
            (f) => rel === f || rel.startsWith(`${f}${path.sep}`),
          );
          if (hit !== undefined)
            violations.push(`${path.relative(root, file)} -> ${rel}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it("core's sources name no other workspace package", () => {
    const offenders = tsFiles(path.join(root, "core/src")).filter((f) =>
      /["']@lakatos-ts\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("lemma's sources name no other workspace package", () => {
    const offenders = tsFiles(path.join(root, "lemma/src")).filter((f) =>
      /["']@lakatos-ts\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("lemma is a workspace package the root builds first", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "lemma/package.json"), "utf8"),
    ) as { name: string; exports: Record<string, unknown> };
    expect(pkg.name).toBe("@lakatos-ts/lemma");
    expect(Object.keys(pkg.exports)).toEqual(["."]);
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    ) as { references: { path: string }[]; include: string[] };
    expect(rootTsconfig.references.map((r) => r.path)).toContain("./lemma");
    expect(rootTsconfig.include).not.toContain("lemma/src");
  });
});
