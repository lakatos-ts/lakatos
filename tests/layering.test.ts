import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The package sources and the directories each may not import from. */
const PACKAGES: { dir: string; forbidden: string[] }[] = [
  {
    dir: "core/src",
    forbidden: ["src", "lemma", "pabst", "engines", "tarski", "thales"],
  },
  {
    dir: "lemma/src",
    forbidden: ["src", "pabst", "engines", "tarski", "thales"],
  },
  {
    dir: "lemma/tests",
    forbidden: ["src", "tests", "core", "pabst", "engines", "tarski", "thales"],
  },
  {
    dir: "pabst/src",
    forbidden: ["src", "tests", "core", "lemma", "engines", "tarski", "thales"],
  },
  {
    dir: "pabst/tests",
    forbidden: ["src", "tests", "core", "lemma", "engines", "tarski", "thales"],
  },
  {
    dir: "thales/tests",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "tarski"],
  },
  {
    dir: "tarski/tests",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "thales"],
  },
];

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

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
      /["']@lakatos\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("lemma's sources name no other workspace package", () => {
    const offenders = tsFiles(path.join(root, "lemma/src")).filter((f) =>
      /["']@lakatos\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("lemma is a workspace package the root builds first", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "lemma/package.json"), "utf8"),
    ) as { name: string; exports: Record<string, unknown> };
    expect(pkg.name).toBe("@lakatos/lemma");
    expect(Object.keys(pkg.exports)).toEqual(["."]);
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    ) as { references: { path: string }[]; include?: string[] };
    expect(rootTsconfig.references.map((r) => r.path)).toContain("./lemma");
    expect(rootTsconfig.include).toBeUndefined();
  });

  it("pabst names no workspace package but core, lemma, and itself", () => {
    const offenders = [
      ...tsFiles(path.join(root, "pabst/src")),
      ...tsFiles(path.join(root, "pabst/tests")),
    ].filter((f) =>
      /["']@lakatos\/(?!core[/"']|lemma["']|pabst[/"'])/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("pabst is a workspace package with a bin and a runtime export", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "pabst/package.json"), "utf8"),
    ) as {
      name: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
    };
    expect(pkg.name).toBe("@lakatos/pabst");
    expect(pkg.bin).toEqual({ pabst: "dist/cli.js" });
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./runtime"]);
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    ) as { references: { path: string }[]; include: string[] };
    expect(rootTsconfig.references.map((r) => r.path)).toContain("./pabst");
    expect(existsSync(path.join(root, "engines/pabst"))).toBe(false);
  });

  it("tarski names no workspace package but lemma, its parser bridge", () => {
    const offenders = tsFiles(path.join(root, "tarski/tests")).filter((f) =>
      /["']@lakatos\/(?!(?:tarski|lemma)["'])/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("thales's suites name no workspace package but core and lemma", () => {
    const offenders = tsFiles(path.join(root, "thales/tests")).filter((f) =>
      /["']@lakatos\/(?!core[/"']|lemma["'])/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  // thales and tarski are Lean executables, so the workspace is the three
  // TypeScript packages and the root holds no sources of its own.
  it("the workspace is core, lemma, and pabst, with no thales or tarski package", () => {
    expect(existsSync(path.join(root, "thales/package.json"))).toBe(false);
    expect(existsSync(path.join(root, "tarski/package.json"))).toBe(false);
    const rootPkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { workspaces: string[] };
    expect(rootPkg.workspaces).toEqual(["core", "lemma", "pabst"]);
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    ) as {
      references: { path: string }[];
      files?: string[];
      include?: string[];
    };
    expect(rootTsconfig.references.map((r) => r.path)).toEqual([
      "./core",
      "./lemma",
      "./pabst",
    ]);
    expect(rootTsconfig.files).toEqual([]);
    expect(rootTsconfig.include).toBeUndefined();
    expect(existsSync(path.join(root, "src"))).toBe(false);
    expect(existsSync(path.join(root, "engines"))).toBe(false);
    expect(existsSync(path.join(root, "schemas"))).toBe(false);
  });

  // The emission is a lemma document's field now, so its schema ships
  // with lemma's, which it references.
  it("lemma's tarball ships every schema the document references", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "-w", "lemma"], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as { files: { path: string }[] }[];
    const paths = packed!.files.map((f) => f.path);
    for (const schema of [
      "lemma-document.schema.json",
      "tarski-estree.schema.json",
      "thales-emission.schema.json",
    ])
      expect(paths).toContain(`schemas/${schema}`);
    expect(existsSync(path.join(root, "thales/schemas"))).toBe(false);
  });

  it("every workspace package publishes publicly", () => {
    for (const dir of ["core", "lemma", "pabst"]) {
      const pkg = JSON.parse(
        readFileSync(path.join(root, dir, "package.json"), "utf8"),
      ) as { publishConfig?: { access?: string } };
      expect(pkg.publishConfig?.access, dir).toBe("public");
    }
  });

  it("every workspace package ships its license text", () => {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        [
          "pack",
          "--dry-run",
          "--json",
          ...["core", "lemma", "pabst"].flatMap((w) => ["-w", w]),
        ],
        { cwd: root, encoding: "utf8" },
      ),
    ) as { name: string; files: { path: string }[] }[];
    const missing = packed
      .filter((p) => !p.files.some((f) => f.path === "LICENSE"))
      .map((p) => p.name);
    expect(missing).toEqual([]);
  });

  for (const { pkg: pkgDir, src } of [
    { pkg: "lemma", src: "lemma/src" },
    { pkg: "pabst", src: "pabst/src" },
  ]) {
    it(`${pkgDir} declares every package its sources import at runtime`, () => {
      const pkg = JSON.parse(
        readFileSync(path.join(root, pkgDir, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
      const undeclared = new Set<string>();
      for (const file of tsFiles(path.join(root, src))) {
        const text = readFileSync(file, "utf8");
        for (const [, name] of text.matchAll(
          /^import\s+(?!type\b)[^"]*?from\s+"([^".][^"]*)"/gm,
        )) {
          if (!name!.startsWith("node:") && !declared.has(packageName(name!)))
            undeclared.add(name!);
        }
      }
      expect([...undeclared]).toEqual([]);
    });
  }
});
