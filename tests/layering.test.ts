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
  { dir: "src", forbidden: ["core", "lemma", "pabst"] },
  {
    dir: "thales/frontend/src",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "tarski"],
  },
  {
    dir: "thales/frontend/tests",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "tarski"],
  },
  {
    dir: "thales/tests",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "tarski"],
  },
  {
    dir: "tarski/frontend/src",
    forbidden: ["src", "tests", "core", "lemma", "pabst", "engines", "thales"],
  },
  {
    dir: "tarski/frontend/tests",
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
    ) as { references: { path: string }[]; include: string[] };
    expect(rootTsconfig.references.map((r) => r.path)).toContain("./lemma");
    expect(rootTsconfig.include).not.toContain("lemma/src");
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

  it("tarski names no other workspace package", () => {
    const offenders = [
      ...tsFiles(path.join(root, "tarski/frontend/src")),
      ...tsFiles(path.join(root, "tarski/frontend/tests")),
    ].filter((f) =>
      /["']@lakatos\/(?!tarski[/"'])/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("tarski is a workspace package with the test262 bin and the ESTree schema", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "tarski/package.json"), "utf8"),
    ) as {
      name: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      dependencies?: Record<string, string>;
    };
    expect(pkg.name).toBe("@lakatos/tarski");
    expect(pkg.bin).toEqual({ "tarski-test262": "dist/test262/cli.js" });
    expect(Object.keys(pkg.exports).sort()).toEqual([
      ".",
      "./schemas/tarski-estree.schema.json",
    ]);
    expect(
      Object.keys(pkg.dependencies ?? {}).filter((d) =>
        d.startsWith("@lakatos/"),
      ),
    ).toEqual([]);
    const rootPkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { bin?: Record<string, string> };
    expect(rootPkg.bin?.["tarski-test262"]).toBeUndefined();
    expect(
      existsSync(path.join(root, "schemas/tarski-estree.schema.json")),
    ).toBe(false);
  });

  // `dist/test262/` needs a recursive glob, which must not sweep in the
  // build info tsc -b writes beside the output.
  it("tarski's tarball ships no build info", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "-w", "tarski"], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as { files: { path: string }[] }[];
    const paths = packed!.files.map((f) => f.path);
    expect(paths).toContain("dist/test262/cli.js");
    expect(paths.filter((p) => p.endsWith(".tsbuildinfo"))).toEqual([]);
  });

  it("thales names no workspace package but core, lemma, tarski, and itself", () => {
    const offenders = [
      ...tsFiles(path.join(root, "thales/frontend/src")),
      ...tsFiles(path.join(root, "thales/frontend/tests")),
      ...tsFiles(path.join(root, "thales/tests")),
    ].filter((f) =>
      /["']@lakatos\/(?!core[/"']|lemma["']|tarski[/"']|thales["'])/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("thales is a workspace package with its bin, and engines/ is gone", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "thales/package.json"), "utf8"),
    ) as {
      name: string;
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe("@lakatos/thales");
    expect(pkg.bin).toEqual({
      thales: "dist/cli.js",
      "thales-exe": "dist/exe-cli.js",
    });
    expect(Object.keys(pkg.exports)).toEqual(["."]);
    expect(Object.keys(pkg.scripts).sort()).toEqual([
      "check:envelopes",
      "check:verdict-channel",
    ]);
    const rootTsconfig = JSON.parse(
      readFileSync(path.join(root, "tsconfig.json"), "utf8"),
    ) as { references: { path: string }[]; include: string[] };
    expect(rootTsconfig.references.map((r) => r.path)).toContain("./thales");
    expect(rootTsconfig.include).toEqual(["src"]);
    expect(existsSync(path.join(root, "engines"))).toBe(false);
    expect(existsSync(path.join(root, "schemas"))).toBe(false);
  });

  it("thales's tarball ships no build info", () => {
    const [packed] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "-w", "thales"], {
        cwd: root,
        encoding: "utf8",
      }),
    ) as { files: { path: string }[] }[];
    const paths = packed!.files.map((f) => f.path);
    expect(paths).toContain("dist/cli.js");
    expect(paths).toContain("schemas/thales-emission.schema.json");
    expect(paths.filter((p) => p.endsWith(".tsbuildinfo"))).toEqual([]);
  });

  it("every workspace package publishes publicly", () => {
    for (const dir of ["core", "lemma", "pabst", "tarski", "thales"]) {
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
          ...["core", "lemma", "pabst", "tarski", "thales"].flatMap((w) => [
            "-w",
            w,
          ]),
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
    { pkg: "tarski", src: "tarski/frontend/src" },
    { pkg: "thales", src: "thales/frontend/src" },
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
