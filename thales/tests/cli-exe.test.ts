import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { runExeRaw, useTempProject } from "./helpers/cli.js";
import { RUN_ROOT } from "@lakatos/core/run-dir";
import { type BinaryResult, findTarskiRoot } from "@lakatos/tarski";

// The evaluator is mocked at the package seam, and only its *build* is:
// `runDocument` stays real, so the spawn path, the argv, and the
// exit-code classification are all exercised against tarski's
// `fake-tarski.mjs` — a stand-in that obeys a marker literal in the
// document it is handed. The real binary is exercised under
// LAKATOS_TARSKI_E2E in `exe-e2e.test.ts`.
const FAKE = path.join(
  findTarskiRoot()!,
  "frontend/tests/fixtures/fake-tarski.mjs",
);

vi.mock("@lakatos/tarski", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lakatos/tarski")>()),
  ensureBinary: vi.fn((): BinaryResult => ({ kind: "ready", binary: FAKE })),
}));
const { ensureBinary } = await import("@lakatos/tarski");
const ensureBinaryMock = vi.mocked(ensureBinary);

/** A marked program. The marker survives type stripping because it is a
 * string literal in a declaration, which is exactly how the test262 fake
 * tree carries its own. */
const marked = (instruction: string, extra = ""): string =>
  `const marker: string = "fake: ${instruction}";\n${extra}`;

describe("thales-exe", () => {
  useTempProject("thales-cli-exe-", {
    "clean.ts": marked("exit 0"),
    "throws.ts": marked("exit 1 Uncaught RangeError: zero"),
    "template.ts": marked("exit 3 unsupported: TemplateExpression"),
    "malformed.ts": marked("exit 2 tarski: x: malformed"),
    "other.ts": marked("exit 0"),
  });

  it("refuses a run with no file", async () => {
    const r = await runExeRaw([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage: thales-exe");
  });

  it("refuses a run with two files", async () => {
    const r = await runExeRaw(["clean.ts", "other.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage: thales-exe");
  });

  it("refuses a glob that names more than one file", async () => {
    const r = await runExeRaw(["*.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage: thales-exe");
  });

  it("runs a clean program and writes both artifacts", async () => {
    const r = await runExeRaw(["clean.ts"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    // exe announces no run directory — its stderr is the program's — so
    // the artifacts are found the way a user would find them.
    const runs = fs
      .readdirSync(RUN_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const dir = path.join(RUN_ROOT, runs.at(-1)!, "tarski");
    const script = fs.readFileSync(path.join(dir, "clean.js"), "utf8");
    expect(script.startsWith('"use strict";')).toBe(true);
    expect(script).not.toContain("export");
    expect(fs.existsSync(path.join(dir, "clean.json"))).toBe(true);
  });

  it("forwards an uncaught throw's report and exits 1", async () => {
    const r = await runExeRaw(["throws.ts"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Uncaught RangeError: zero");
  });

  it("names the node kind the evaluator does not know and exits 2", async () => {
    const r = await runExeRaw(["template.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "thales-exe: template.ts: unsupported syntax: TemplateExpression",
    );
  });

  it("forwards a refusal of the document and exits 2", async () => {
    const r = await runExeRaw(["malformed.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("tarski: x: malformed");
    expect(r.stderr).toContain(
      "thales-exe: the evaluator refused the document thales-exe handed it",
    );
  });

  it("reports a missing evaluator and exits 2", async () => {
    ensureBinaryMock.mockReturnValueOnce({
      kind: "no-project",
      message: "the tarski evaluator is not part of this installation",
    });
    const r = await runExeRaw(["clean.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "thales-exe: the tarski evaluator is not part of this installation",
    );
  });

  it("reports a failed build with both streams and exits 2", async () => {
    ensureBinaryMock.mockReturnValueOnce({
      kind: "failed",
      stdout: "building Tarski.Realm\n",
      stderr: "error: Realm.lean:1:0: boom\n",
    });
    const r = await runExeRaw(["clean.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("building Tarski.Realm");
    expect(r.stderr).toContain("error: Realm.lean:1:0: boom");
    expect(r.stderr).toContain("thales-exe: lake build tarski failed");
  });
});

describe("thales-exe's typecheck gate", () => {
  useTempProject(
    "thales-cli-exe-no-tsconfig-",
    { "clean.ts": marked("exit 0") },
    { tsconfig: false },
  );

  it("refuses a project with no tsconfig.json", async () => {
    const r = await runExeRaw(["clean.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("thales-exe: no tsconfig.json:");
  });
});

describe("thales-exe on a program that does not type check", () => {
  useTempProject("thales-cli-exe-illtyped-", {
    "bad.ts": "const n: number = 'x';\n",
  });

  it("reports each diagnostic and refuses the run", async () => {
    const r = await runExeRaw(["bad.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("TS2322");
    expect(r.stderr).toContain(
      "thales-exe: the program does not type check under lakatos's required options",
    );
  });
});

describe("thales-exe on a file the program leaves out", () => {
  useTempProject(
    "thales-cli-exe-outside-",
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", types: [] },
        include: ["src"],
        exclude: [".lakatos"],
      }),
      "src/inside.ts": marked("exit 0"),
      "outside.ts": marked("exit 0"),
    },
    { tsconfig: false },
  );

  it("refuses it in the issue's own words", async () => {
    const r = await runExeRaw(["outside.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "thales-exe: outside.ts is not part of the program tsconfig.json describes, so it was not type checked",
    );
  });
});
