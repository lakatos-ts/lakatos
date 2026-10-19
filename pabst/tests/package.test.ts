import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(
  readFileSync(path.join(pkgDir, "package.json"), "utf8"),
) as {
  name: string;
  bin: Record<string, string>;
  exports: Record<string, unknown>;
  publishConfig?: { access?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function packed(): string[] {
  const [result] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: pkgDir,
      encoding: "utf8",
    }),
  ) as { files: { path: string }[] }[];
  return result!.files.map((f) => f.path);
}

describe("the pabst package", () => {
  it("has a bin and a runtime export", () => {
    expect(pkg.name).toBe("@lakatos/pabst");
    expect(pkg.bin).toEqual({ pabst: "dist/cli.js" });
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./runtime"]);
  });

  it("publishes publicly", () => {
    expect(pkg.publishConfig?.access).toBe("public");
  });

  it("ships its license", () => {
    expect(packed()).toContain("LICENSE");
  });

  it("declares every package its sources import at runtime", () => {
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const src = path.join(pkgDir, "src");
    const undeclared = new Set<string>();
    for (const file of readdirSync(src, {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
      const text = readFileSync(path.join(src, file), "utf8");
      for (const [, name] of text.matchAll(
        /^import\s+(?!type\b)[^"]*?from\s+"([^".][^"]*)"/gm,
      )) {
        if (!name!.startsWith("node:") && !declared.has(packageName(name!)))
          undeclared.add(name!);
      }
    }
    expect([...undeclared]).toEqual([]);
  });
});
