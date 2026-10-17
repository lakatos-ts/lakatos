import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = path.join(root, "scripts", "ci-scope.js");

const GROUPS = ["prover", "semantics", "exe", "parity"] as const;
type Group = (typeof GROUPS)[number];

/** The answer selecting exactly `groups`. */
const only = (...groups: Group[]): Record<string, string> =>
  Object.fromEntries(GROUPS.map((g) => [g, String(groups.includes(g))]));

// The script answers as the workflow will read it: one `group=bool` line
// per group, appended to GITHUB_OUTPUT.
const select = (paths: string[], ...flags: string[]): Record<string, string> =>
  Object.fromEntries(
    execFileSync("node", [script, "select", "lean", ...flags], {
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
  it("a docs-only diff selects no Lean job", () => {
    expect(select(["README.md", "docs/design/five-tools.md"])).toEqual(only());
  });

  it("a pabst source change selects only the parity host", () => {
    expect(select(["pabst/src/cli.ts", "pabst/tests/cli.test.ts"])).toEqual(
      only("parity"),
    );
  });

  it("a pabst fixture also selects the exe fixture suite", () => {
    expect(select(["pabst/tests/fixtures/e2e/bounded.ts"])).toEqual(
      only("parity", "exe"),
    );
  });

  it("a lemma change runs the prover and the exe suite", () => {
    expect(select(["lemma/tests/cli.test.ts"])).toEqual(only("prover", "exe"));
  });

  it("a core change runs the prover and nothing of the semantics", () => {
    expect(select(["core/src/envelope.ts"])).toEqual(only("prover"));
  });

  it.each([
    "lemma/src/estree.ts",
    "lemma/schemas/tarski-estree.schema.json",
    "lemma/package.json",
  ])("a parser bridge change (%s) runs the semantics too", (p) => {
    expect(select([p])).toEqual(only("prover", "semantics", "exe"));
  });

  it.each([
    "thales/ThalesDsl/Emit.lean",
    "thales/Thales/Cli.lean",
    "thales/scripts/check-envelopes.js",
    "thales/tests/cli-bin.test.ts",
    "thales/README.md",
    "thales/CLAUDE.md",
  ])("a prover-only change (%s) skips the test262 slice", (p) => {
    expect(select([p])).toEqual(only("prover"));
  });

  it.each([
    "thales/tests/fixtures/tracer.ts",
    "thales/tests/conformance/theorem/stacked-blocks.ts",
  ])("a thales fixture (%s) also runs the exe fixture suite", (p) => {
    expect(select([p])).toEqual(only("prover", "exe"));
  });

  it.each([
    "thales/Tarski/Eval.lean",
    "thales/Js/Runtime.lean",
    "thales/Js.lean",
    "thales/Test/Tarski/NumberTest.lean",
    "thales/Test/fixtures/fake-tarski.sh",
    "thales/tests/tarski/exe-e2e.test.ts",
    "thales/test262/slice.txt",
    "thales/scripts/check-imports.sh",
    "thales/scripts/lean-strip.awk",
    "thales/lakefile.lean",
    "thales/lean-toolchain",
  ])("a semantics change (%s) runs the prover and the slice", (p) => {
    expect(select([p])).toEqual(only("prover", "semantics"));
  });

  it("the workflow and its setup action select both Lean groups", () => {
    expect(select([".github/workflows/lean.yml"])).toEqual(
      only("prover", "semantics"),
    );
    expect(select([".github/actions/lean-setup/action.yml"])).toEqual(
      only("prover", "semantics"),
    );
    expect(select([".github/workflows/lakatos.yml"])).toEqual(only());
  });

  it.each(["package-lock.json", "vitest.config.ts", "scripts/ci-scope.js"])(
    "a dependency, test config, or selection change (%s) runs both Lean groups",
    (p) => {
      expect(select([p])).toEqual(only("prover", "semantics"));
    },
  );

  it("a sibling directory sharing a prefix does not select", () => {
    expect(
      select(["tests-notes/a.md", "core2/x.ts", "thalesx/a.lean"]),
    ).toEqual(only());
  });

  it("a sibling of a semantics directory is the prover's alone", () => {
    expect(select(["thales/Tarskix/A.lean", "thales/Jsx.lean"])).toEqual(
      only("prover"),
    );
  });

  it("--all selects every group whatever the diff", () => {
    expect(select([], "--all")).toEqual(
      only("prover", "semantics", "exe", "parity"),
    );
  });

  it("an empty diff selects nothing", () => {
    expect(select([])).toEqual(only());
  });

  it("an unknown workflow or mode exits 2", () => {
    for (const args of [
      ["select", "thales"],
      ["select", "tarski"],
      ["choose", "lean"],
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

type Needs = Record<
  string,
  { result: string; outputs?: Record<string, string> }
>;

const JOBS = [
  "lean-tests",
  "test262-slice",
  "runner-e2e",
  "verdict-channel",
  "envelopes",
  "prove-e2e",
  "verdict-corpus",
] as const;

const PROVER_JOBS = [
  "lean-tests",
  "verdict-channel",
  "envelopes",
  "prove-e2e",
  "verdict-corpus",
];

const succeeded = (...jobs: string[]): Record<string, string> =>
  Object.fromEntries(jobs.map((j) => [j, "success"]));

const needsOf = (
  selected: Record<string, string>,
  results: Record<string, string>,
): Needs => ({
  changes: { result: "success", outputs: selected },
  ...Object.fromEntries(
    JOBS.map((j) => [j, { result: results[j] ?? "skipped" }]),
  ),
});

const gate = (needs: Needs) =>
  spawnSync("node", [script, "gate", "lean"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(needs),
  });

describe("ci-scope gate", () => {
  it("passes when everything was selected and succeeded", () => {
    const r = gate(
      needsOf(only("prover", "semantics", "exe", "parity"), succeeded(...JOBS)),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes when nothing was selected and everything was skipped", () => {
    const r = gate(needsOf(only(), {}));
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes when only the parity host was selected and ran", () => {
    const r = gate(needsOf(only("parity"), succeeded("prove-e2e")));
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes with only the exe suite selected", () => {
    const r = gate(needsOf(only("exe"), succeeded("runner-e2e")));
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes a prover-only run that skipped the slice", () => {
    const r = gate(needsOf(only("prover"), succeeded(...PROVER_JOBS)));
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes a semantics-only run", () => {
    const r = gate(
      needsOf(
        only("semantics"),
        succeeded("lean-tests", "test262-slice", "runner-e2e"),
      ),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(["failure", "cancelled"])(
    "rejects a selected job that ended in %s, naming it",
    (result) => {
      const r = gate(
        needsOf(only("prover"), {
          ...succeeded(...PROVER_JOBS),
          envelopes: result,
        }),
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`envelopes: ${result}, expected success`);
    },
  );

  it("rejects a selected job that was skipped", () => {
    const r = gate(
      needsOf(only("prover"), {
        ...succeeded(...PROVER_JOBS),
        "verdict-corpus": "skipped",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("verdict-corpus: skipped, expected success");
  });

  it("rejects an unselected job that ran", () => {
    const r = gate(
      needsOf(only("prover"), {
        ...succeeded(...PROVER_JOBS),
        "test262-slice": "success",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("test262-slice: success, expected skipped");
  });

  it("rejects a changes job that did not succeed", () => {
    const needs = needsOf(only("prover"), {});
    needs.changes = { result: "failure" };
    const r = gate(needs);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("changes job did not succeed: failure");
  });

  it("rejects a changes job that answered for only some groups", () => {
    const needs = needsOf(only("prover"), succeeded(...PROVER_JOBS));
    needs.changes = { result: "success", outputs: { prover: "true" } };
    const r = gate(needs);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no answer for semantics");
  });

  it("rejects a job the table does not know, and a known job missing", () => {
    const extra = needsOf(only("prover"), succeeded(...PROVER_JOBS));
    extra["verdict-channel-4"] = { result: "success" };
    expect(gate(extra).stderr).toContain(
      "verdict-channel-4: not a job this gate knows",
    );
    const missing = needsOf(only("prover"), succeeded(...PROVER_JOBS));
    delete missing["prove-e2e"];
    const r = gate(missing);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("prove-e2e: missing, expected success");
  });
});

// The workflow feeds the script git's own listing, NUL-separated: git
// otherwise C-quotes a path with a non-ASCII byte, and a quoted path
// matches nothing.
describe("ci-scope select over git's listing", () => {
  const git = (cwd: string, ...args: string[]): Buffer =>
    execFileSync("git", args, { cwd, stdio: "pipe" });

  const diffOf = (files: string[]): Buffer => {
    const repo = mkdtempSync(path.join(tmpdir(), "ci-scope-"));
    try {
      git(repo, "init", "--quiet");
      git(repo, "config", "user.email", "test@example.com");
      git(repo, "config", "user.name", "Test");
      writeFileSync(path.join(repo, "README.md"), "one\n");
      git(repo, "add", ".");
      git(repo, "commit", "--quiet", "-m", "one");
      const base = git(repo, "rev-parse", "HEAD").toString().trim();
      for (const f of files) {
        mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
        writeFileSync(path.join(repo, f), "two\n");
      }
      git(repo, "add", ".");
      git(repo, "commit", "--quiet", "-m", "two");
      return git(
        repo,
        "diff",
        "-z",
        "--name-only",
        "--no-renames",
        `${base}...HEAD`,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  };

  const selectFrom = (listing: Buffer) =>
    Object.fromEntries(
      execFileSync("node", [script, "select", "lean"], {
        cwd: root,
        encoding: "utf8",
        input: listing,
      })
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );

  it("an exact-file pattern matches a NUL-terminated path", () => {
    expect(selectFrom(diffOf(["package-lock.json"]))).toEqual(
      only("prover", "semantics"),
    );
  });

  it("a path with a non-ASCII byte still selects", () => {
    const listing = diffOf(["thales/ThalesDsl/café.lean", "docs/über.md"]);
    expect(listing.toString("utf8")).not.toContain('"');
    expect(selectFrom(listing)).toEqual(only("prover"));
  });
});
