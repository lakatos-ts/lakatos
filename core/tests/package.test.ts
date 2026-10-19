import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the core package", () => {
  it("publishes publicly", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    ) as { publishConfig?: { access?: string } };
    expect(pkg.publishConfig?.access).toBe("public");
  });

  it("ships its license", () => {
    const [result] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: pkgDir,
        encoding: "utf8",
      }),
    ) as { files: { path: string }[] }[];
    expect(result!.files.map((f) => f.path)).toContain("LICENSE");
  });
});
