import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = path.join(root, "scripts", "ci-scope.js");

// The script answers as the workflows will read it: one `group=bool`
// line per group, appended to GITHUB_OUTPUT.
const select = (
  workflow: string,
  paths: string[],
  ...flags: string[]
): Record<string, string> =>
  Object.fromEntries(
    execFileSync("node", [script, "select", workflow, ...flags], {
      cwd: root,
      encoding: "utf8",
      input: paths.map((p) => `${p}\n`).join(""),
    })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=")),
  );

describe("ci-scope select", () => {
  it("a docs-only diff selects no Lean job in either workflow", () => {
    const paths = ["README.md", "docs/design/five-tools.md"];
    expect(select("thales", paths)).toEqual({ lean: "false", parity: "false" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "false" });
  });

  it("a pabst source change selects only the parity host", () => {
    const paths = ["pabst/src/cli.ts", "pabst/tests/cli.test.ts"];
    expect(select("thales", paths)).toEqual({ lean: "false", parity: "true" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "false" });
  });

  it("a pabst fixture also selects the exe fixture suite", () => {
    const paths = ["pabst/tests/fixtures/e2e/bounded.ts"];
    expect(select("thales", paths)).toEqual({ lean: "false", parity: "true" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "true" });
  });

  it.each(["core/src/envelope.ts", "lemma/src/index.ts"])(
    "a shared package change (%s) runs all of thales and the exe suite",
    (p) => {
      expect(select("thales", [p])).toEqual({ lean: "true", parity: "false" });
      expect(select("tarski", [p])).toEqual({ lean: "false", exe: "true" });
    },
  );

  it("a thales Lean change runs thales and nothing in tarski", () => {
    const paths = ["thales/ThalesDsl/Emit.lean"];
    expect(select("thales", paths)).toEqual({ lean: "true", parity: "false" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "false" });
  });

  it("a thales front-end change runs thales and the exe suite", () => {
    const paths = ["thales/frontend/src/exe.ts"];
    expect(select("thales", paths)).toEqual({ lean: "true", parity: "false" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "true" });
  });

  it("a tarski change runs both workflows in full", () => {
    const paths = ["tarski/Tarski/Eval.lean"];
    expect(select("thales", paths)).toEqual({ lean: "true", parity: "false" });
    expect(select("tarski", paths)).toEqual({ lean: "true", exe: "false" });
  });

  it("a workflow or setup action selects its own workflow only", () => {
    expect(select("thales", [".github/workflows/tarski.yml"])).toEqual({
      lean: "false",
      parity: "false",
    });
    expect(select("tarski", [".github/workflows/tarski.yml"])).toEqual({
      lean: "true",
      exe: "false",
    });
    expect(
      select("thales", [".github/actions/thales-setup/action.yml"]),
    ).toEqual({ lean: "true", parity: "false" });
    expect(select("tarski", [".github/workflows/lakatos.yml"])).toEqual({
      lean: "false",
      exe: "false",
    });
  });

  it.each(["package-lock.json", "vitest.config.ts", "scripts/ci-scope.js"])(
    "a dependency, test config, or selection change (%s) runs everything",
    (p) => {
      expect(select("thales", [p])).toEqual({ lean: "true", parity: "false" });
      expect(select("tarski", [p])).toEqual({ lean: "true", exe: "false" });
    },
  );

  it("a sibling directory sharing a prefix does not select", () => {
    const paths = ["tests-notes/a.md", "core2/x.ts", "thalesx/a.lean"];
    expect(select("thales", paths)).toEqual({ lean: "false", parity: "false" });
    expect(select("tarski", paths)).toEqual({ lean: "false", exe: "false" });
  });

  it("--all selects every group whatever the diff", () => {
    expect(select("thales", [], "--all")).toEqual({
      lean: "true",
      parity: "true",
    });
    expect(select("tarski", [], "--all")).toEqual({
      lean: "true",
      exe: "true",
    });
  });

  it("an empty diff selects nothing", () => {
    expect(select("thales", [])).toEqual({ lean: "false", parity: "false" });
  });

  it("an unknown workflow or mode exits 2", () => {
    for (const args of [
      ["select", "pabst"],
      ["choose", "thales"],
      ["select"],
    ]) {
      const r = spawnSync("node", [script, ...args], {
        cwd: root,
        encoding: "utf8",
        input: "",
      });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("usage");
    }
  });

  // A pattern that names nothing in the tree is a typo or a rename nobody
  // carried here; either way the job it guards would never run again.
  it("every pattern names a path in the tree", () => {
    const table = execFileSync("node", [script, "patterns"], {
      cwd: root,
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(table.length).toBeGreaterThan(10);
    for (const pattern of table) {
      expect(existsSync(path.join(root, pattern)), pattern).toBe(true);
    }
  });
});
