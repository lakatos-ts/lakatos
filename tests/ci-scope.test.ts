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

  it.each(["core/src/envelope.ts", "lemma/tests/cli.test.ts"])(
    "a shared package change (%s) runs all of thales and the exe suite",
    (p) => {
      expect(select("thales", [p])).toEqual({ lean: "true", parity: "false" });
      expect(select("tarski", [p])).toEqual({ lean: "false", exe: "true" });
    },
  );

  it.each([
    "lemma/src/estree.ts",
    "lemma/schemas/tarski-estree.schema.json",
    "lemma/package.json",
  ])("a parser bridge change (%s) runs all of tarski too", (p) => {
    expect(select("thales", [p])).toEqual({ lean: "true", parity: "false" });
    expect(select("tarski", [p])).toEqual({ lean: "true", exe: "true" });
  });

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

type Needs = Record<
  string,
  { result: string; outputs?: Record<string, string> }
>;

const gate = (workflow: string, needs: Needs) =>
  spawnSync("node", [script, "gate", workflow], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(needs),
  });

const thalesNeeds = (
  selected: { lean: string; parity: string },
  results: Record<string, string>,
): Needs => ({
  changes: { result: "success", outputs: selected },
  "lean-tests": { result: results["lean-tests"] ?? "skipped" },
  "verdict-channel": { result: results["verdict-channel"] ?? "skipped" },
  envelopes: { result: results.envelopes ?? "skipped" },
  "prove-e2e": { result: results["prove-e2e"] ?? "skipped" },
  "verdict-corpus": { result: results["verdict-corpus"] ?? "skipped" },
});

const allThales = {
  "lean-tests": "success",
  "verdict-channel": "success",
  envelopes: "success",
  "prove-e2e": "success",
  "verdict-corpus": "success",
};

describe("ci-scope gate", () => {
  it("passes when everything was selected and succeeded", () => {
    const r = gate(
      "thales",
      thalesNeeds({ lean: "true", parity: "false" }, allThales),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes when nothing was selected and everything was skipped", () => {
    const r = gate(
      "thales",
      thalesNeeds({ lean: "false", parity: "false" }, {}),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes when only the parity host was selected and ran", () => {
    const r = gate(
      "thales",
      thalesNeeds(
        { lean: "false", parity: "true" },
        { "prove-e2e": "success" },
      ),
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it("passes for tarski with only the exe suite selected", () => {
    const r = gate("tarski", {
      changes: { result: "success", outputs: { lean: "false", exe: "true" } },
      "lean-tests": { result: "skipped" },
      "test262-slice": { result: "skipped" },
      "runner-e2e": { result: "success" },
    });
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(["failure", "cancelled"])(
    "rejects a selected job that ended in %s, naming it",
    (result) => {
      const r = gate(
        "thales",
        thalesNeeds(
          { lean: "true", parity: "false" },
          { ...allThales, envelopes: result },
        ),
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`envelopes: ${result}, expected success`);
    },
  );

  it("rejects a selected job that was skipped", () => {
    const r = gate(
      "thales",
      thalesNeeds(
        { lean: "true", parity: "false" },
        { ...allThales, "verdict-corpus": "skipped" },
      ),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("verdict-corpus: skipped, expected success");
  });

  it("rejects an unselected job that ran", () => {
    const r = gate(
      "thales",
      thalesNeeds(
        { lean: "false", parity: "false" },
        { "lean-tests": "success" },
      ),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("lean-tests: success, expected skipped");
  });

  it("rejects a changes job that did not succeed", () => {
    const needs = thalesNeeds({ lean: "true", parity: "false" }, {});
    needs.changes = { result: "failure" };
    const r = gate("thales", needs);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("changes job did not succeed: failure");
  });

  it("rejects a changes job that answered for only some groups", () => {
    const needs = thalesNeeds({ lean: "true", parity: "false" }, allThales);
    needs.changes = { result: "success", outputs: { lean: "true" } };
    const r = gate("thales", needs);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no answer for parity");
  });

  it("rejects a job the table does not know, and a known job missing", () => {
    const extra = thalesNeeds({ lean: "true", parity: "false" }, allThales);
    extra["verdict-channel-4"] = { result: "success" };
    expect(gate("thales", extra).stderr).toContain(
      "verdict-channel-4: not a job this gate knows",
    );
    const missing = thalesNeeds({ lean: "true", parity: "false" }, allThales);
    delete missing["prove-e2e"];
    const r = gate("thales", missing);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("prove-e2e: missing, expected success");
  });
});

// The workflows feed the script git's own listing, NUL-separated: git
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

  const selectFrom = (workflow: string, listing: Buffer) =>
    Object.fromEntries(
      execFileSync("node", [script, "select", workflow], {
        cwd: root,
        encoding: "utf8",
        input: listing,
      })
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );

  it("an exact-file pattern matches a NUL-terminated path", () => {
    const listing = diffOf(["package-lock.json"]);
    expect(selectFrom("thales", listing)).toEqual({
      lean: "true",
      parity: "false",
    });
    expect(selectFrom("tarski", listing)).toEqual({
      lean: "true",
      exe: "false",
    });
  });

  it("a path with a non-ASCII byte still selects", () => {
    const listing = diffOf(["thales/ThalesDsl/café.lean", "docs/über.md"]);
    expect(listing.toString("utf8")).not.toContain('"');
    expect(selectFrom("thales", listing)).toEqual({
      lean: "true",
      parity: "false",
    });
  });
});
