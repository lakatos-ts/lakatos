import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The line a lake `require` held while the semantics and the prover were
// two packages: nothing under Js/ or Tarski/ imports the prover.

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));
const CHECK = path.join(PACKAGE, "scripts", "check-imports.sh");
const BOUNDARY = path.join(PACKAGE, "scripts", "check-boundary.sh");

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A package root holding `files`, path to text, under `prefix`. */
function tree(
  files: Record<string, string>,
  prefix = "check-imports-",
): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(root);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

const run = (script: string, ...args: string[]) =>
  spawnSync("sh", [script, ...args], { cwd: PACKAGE, encoding: "utf8" });

describe("check-imports.sh", () => {
  it("passes a semantics that imports only itself and core", () => {
    const r = run(
      CHECK,
      tree({
        "Js.lean": "import Js.Runtime\n",
        "Js/Runtime.lean": "import Lean\n",
        "Tarski/Eval.lean": "import Js\nimport Tarski.Value\n",
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("imports: 3 file(s) clean");
  });

  it.each<[string, string, number]>([
    ["Tarski/Eval.lean", "import ThalesDsl\n", 1],
    ["Js/Runtime.lean", "import Js.Val\nimport ThalesEmit.Json\n", 2],
    ["Tarski/Main.lean", "import Thales.Cli\n", 1],
    ["Tarski.lean", "import Tarski.Eval\nimport ThalesDsl.Prove\n", 2],
    ["Js.lean", "import ThalesDsl\n", 1],
    ["Tarski/Eval.lean", "public import ThalesDsl.Prove\n", 1],
    ["Tarski/Eval.lean", "import all ThalesDsl\n", 1],
    ["Tarski/Eval.lean", "public meta import ThalesEmit\n", 1],
    ["Tarski/Eval.lean", "import Js\r\nimport ThalesDsl\r\n", 2],
    ["Tarski/Eval.lean", "/- a note -/ import ThalesDsl\n", 1],
  ])("refuses %s importing the prover: %j", (file, text, line) => {
    const root = tree({ [file]: text });
    const r = run(CHECK, root);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain(`${root}/${file}:${line}:`);
    expect(r.stdout).toContain("imports: 1 violation(s)");
  });

  it("finds a violation under a root whose path has a space", () => {
    const root = tree(
      { "Tarski/Eval.lean": "import ThalesDsl\n" },
      "with space-",
    );
    const r = run(CHECK, root);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain(`${root}/Tarski/Eval.lean:1:`);
  });

  it("passes a module whose name only starts like the prover's", () => {
    const r = run(
      CHECK,
      tree({
        "Tarski/Eval.lean": "import ThalesDslX\nimport Thalesian.Notes\n",
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("passes an import that only a comment spells", () => {
    const r = run(
      CHECK,
      tree({
        "Tarski/Eval.lean":
          "-- import ThalesDsl\n/-! The prover's side:\nimport ThalesEmit\n-/\nimport Js\n",
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("does not scan the prover's own libraries", () => {
    const r = run(
      CHECK,
      tree({
        "ThalesDsl/Prove.lean": "import ThalesDsl.Ast\n",
        "Thales/Cli.lean": "import Thales.Prove\n",
        "Tarski/Eval.lean": "import Js\n",
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("imports: 1 file(s) clean");
  });

  // The check is the only thing holding the line, so a scan that could
  // not look is a failure, never a pass.
  it.each<[string, string[]]>([
    ["no semantics trees", []],
    ["empty semantics trees", ["Js", "Tarski"]],
  ])("refuses a root with %s", (_, dirs) => {
    const root = tree({});
    for (const d of dirs) mkdirSync(path.join(root, d));
    const r = run(CHECK, root);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stdout).toContain("imports: no Lean files under");
  });

  it("refuses a root that does not exist", () => {
    const r = run(CHECK, path.join(tree({}), "missing"));
    expect(r.status, r.stdout + r.stderr).toBe(2);
  });

  it("refuses a file it cannot read", () => {
    const root = tree({
      "Tarski/Eval.lean": "import Js\n",
      "Tarski/Hidden.lean": "import ThalesDsl\n",
    });
    chmodSync(path.join(root, "Tarski/Hidden.lean"), 0o000);
    const r = run(CHECK, root);
    expect(r.status, r.stdout + r.stderr).toBe(2);
    expect(r.stdout).toContain(
      `imports: cannot read ${root}/Tarski/Hidden.lean`,
    );
  });

  it("passes this package", () => {
    const r = run(CHECK);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/imports: \d+ file\(s\) clean/);
  });

  it("refuses the planted fixture CI points it at", () => {
    const r = run(CHECK, "scripts/import-fixture");
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("scripts/import-fixture/Tarski/Planted.lean:");
  });
});

describe("check-boundary.sh over the shared comment stripping", () => {
  it("passes Tarski/", () => {
    const r = run(BOUNDARY);
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("refuses its planted fixture", () => {
    const r = run(BOUNDARY, "scripts/boundary-fixture");
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain("Violation.lean");
  });

  it("ignores a Float call a comment or a string spells", () => {
    const r = run(
      BOUNDARY,
      tree({
        "A.lean": '-- Float.sqrt\n/- x.isNaN -/\ndef s := "Float.sqrt"\n',
      }),
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
