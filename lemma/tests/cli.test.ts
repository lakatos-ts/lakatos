import { describe, it, expect, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.js";
import { admittedDocument } from "../src/document.js";
import { useTempProject } from "./helpers/temp-project.js";
import { schemaValidator } from "./helpers/schema-validator.js";

const validate = schemaValidator(
  new URL("../schemas/lemma-document.schema.json", import.meta.url),
  "lemma document",
  [
    new URL("../schemas/tarski-estree.schema.json", import.meta.url),
    new URL("../schemas/thales-emission.schema.json", import.meta.url),
  ],
);

const fixture = (name: string): string =>
  fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const golden = (name: string): unknown =>
  JSON.parse(readFileSync(fixture(name), "utf8"));

/** Run `main` with stdout and stderr captured, as the command's caller
 * sees them. */
function invoke(...argv: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  let stdout = "";
  let stderr = "";
  const out = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  const log = vi.spyOn(console, "log").mockImplementation((...args) => {
    stdout += `${args.join(" ")}\n`;
  });
  const err = vi.spyOn(console, "error").mockImplementation((...args) => {
    stderr += `${args.join(" ")}\n`;
  });
  try {
    return { status: main(argv), stdout, stderr };
  } finally {
    out.mockRestore();
    log.mockRestore();
    err.mockRestore();
  }
}

/** The one indented document a run without `--jsonl` prints, checked
 * against the schema. */
function parsed(stdout: string): Record<string, unknown> {
  const d = JSON.parse(stdout) as Record<string, unknown>;
  validate(d);
  return d;
}

/** Every line of a `--jsonl` run, each checked against the schema. */
function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trimEnd()
    .split("\n")
    .map((l) => {
      const d = JSON.parse(l) as Record<string, unknown>;
      validate(d);
      return d;
    });
}

describe("lemma parse", () => {
  it("prints one indented document whose program is the golden", () => {
    const r = invoke("parse", fixture("numeric-loop.js"));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^\{\n {2}"schemaVersion": 0,/);
    const d = JSON.parse(r.stdout);
    validate(d);
    expect(d).toEqual({
      schemaVersion: 0,
      file: fixture("numeric-loop.js"),
      gated: false,
      outcome: "program",
      program: golden("numeric-loop.estree.json"),
    });
  });

  it("prints one line per file with --jsonl, in order", () => {
    const r = invoke(
      "parse",
      "--jsonl",
      fixture("arithmetic.js"),
      fixture("counter.js"),
    );
    expect(r.status).toBe(0);
    const ds = lines(r.stdout);
    expect(ds.map((d) => d.program)).toEqual([
      golden("arithmetic.estree.json"),
      golden("counter.estree.json"),
    ]);
  });

  it("refuses a file that does not parse, with the position, and exits 1", () => {
    const r = invoke("parse", "--jsonl", fixture("syntax-error.js"));
    expect(r.status).toBe(1);
    const [d] = lines(r.stdout);
    expect(d).toMatchObject({ outcome: "refused", reason: "syntax" });
    expect(d!.message).toContain("syntax-error.js:2:");
  });

  it("refuses an unreadable file and still answers for the rest", () => {
    const r = invoke(
      "parse",
      "--jsonl",
      "no-such-file.js",
      fixture("arithmetic.js"),
    );
    expect(r.status).toBe(1);
    const ds = lines(r.stdout);
    expect(ds[0]).toMatchObject({
      file: "no-such-file.js",
      outcome: "refused",
      reason: "unreadable",
    });
    expect(ds[1]).toMatchObject({ outcome: "program" });
  });
});

describe("lemma check", () => {
  useTempProject("lemma-cli-check-", {
    "src/a.ts": "export const a: number = 1 + 2;\nconsole.log(a);\n",
    "src/b.ts": "const b = (x: string): string => x;\nb('hi');\n",
    "outside.mts": "export {};\n",
  });

  it("strips types, parses the script, and carries both", () => {
    const r = invoke("check", "src/a.ts");
    expect(r.status).toBe(0);
    const d = JSON.parse(r.stdout);
    validate(d);
    expect(d).toMatchObject({
      file: "src/a.ts",
      gated: true,
      outcome: "program",
    });
    expect(d.script).toBe('"use strict";\nconst a = 1 + 2;\nconsole.log(a);\n');
    expect(d.program.body[0]).toMatchObject({ directive: "use strict" });
  });

  it("answers for several files in one gate with --jsonl", () => {
    const r = invoke("check", "--jsonl", "src/a.ts", "src/b.ts");
    expect(r.status).toBe(0);
    expect(lines(r.stdout).map((d) => d.file)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("refuses a file the tsconfig's program leaves out", () => {
    const r = invoke("check", "outside.mts");
    expect(r.status).toBe(1);
    expect(parsed(r.stdout)).toMatchObject({
      reason: "outside-program",
      gated: true,
    });
  });
});

describe("lemma check: files the check did not read", () => {
  const dir = useTempProject("lemma-cli-cache-", {
    "src/a.ts": "export const a = 1;\n",
  });

  it("calls a missing file outside the program, not unreadable", () => {
    const r = invoke("check", "--jsonl", "src/nope.ts");
    expect(r.status).toBe(1);
    expect(lines(r.stdout)[0]).toMatchObject({ reason: "outside-program" });
  });

  it("writes the gate's cache where --tsbuildinfo says", () => {
    const r = invoke(
      "check",
      "--tsbuildinfo",
      "cache/tc.tsbuildinfo",
      "src/a.ts",
    );
    expect(r.status).toBe(0);
    expect(existsSync(path.join(dir, "cache/tc.tsbuildinfo"))).toBe(true);
  });
});

describe("lemma check: the emission", () => {
  useTempProject("lemma-cli-emit-", {
    "src/f.ts":
      "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x } */\n" +
      "export function f(x: number): number { return x; }\n",
    "src/typo.ts":
      "function h(x: number): number { return x; }\n" +
      "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x }\n" +
      " *  @ensures{bad} forall (x: int ∈ [0, 5)) { h(x) === x } */\n" +
      "export function f(x: number): number { return h(x); }\n",
    "src/other.ts":
      "function h(x: number): number { return x; }\n" +
      "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x }\n" +
      " *  @ensures{bad} forall (x: int ∈ [0, 5)) { h(x) === x } */\n" +
      "export function f(x: number): number { return h(x); }\n",
    "src/bad.ts":
      "/** @ensures{p} forall (n: int) { forall (m: int) { f(n) === m } } */\n" +
      "export function f(x: number): number { return x; }\n",
  });

  it("carries thales's emission for a gated file, as thales writes it", () => {
    const r = invoke("check", "src/f.ts");
    expect(r.status).toBe(0);
    const d = parsed(r.stdout);
    expect(d.emission).toMatchObject({
      file: "src/f.ts",
      obligations: [{ function: "f", property: "id" }],
    });
    expect(d).toEqual(
      JSON.parse(JSON.stringify(admittedDocument("src/f.ts").document)),
    );
  });

  it("leaves out an annotation the gate's formula typing refuses", () => {
    // `h` is not exported, so an atom naming it is refused at the gate;
    // the emitter alone would have made it an obligation.
    const obligations = (d: unknown) =>
      (d as { obligations: { property: string }[] }).obligations.map(
        (o) => o.property,
      );
    expect(
      obligations(admittedDocument("src/typo.ts").document.emission),
    ).toEqual(["id", "bad"]);
    const r = invoke("check", "src/typo.ts");
    expect(r.status).toBe(0);
    expect(obligations(parsed(r.stdout).emission)).toEqual(["id"]);
  });

  it("refuses the same annotations under every spelling of a file", () => {
    const r = invoke(
      "check",
      "--jsonl",
      "src/typo.ts",
      "./src/typo.ts",
      "src/other.ts",
    );
    expect(r.status).toBe(0);
    expect(
      lines(r.stdout).map((d) =>
        (d.emission as { obligations: { property: string }[] }).obligations.map(
          (o) => o.property,
        ),
      ),
    ).toEqual([["id"], ["id"], ["id"]]);
  });

  it("refuses a file with a formula Lemma cannot read", () => {
    const r = invoke("check", "--jsonl", "src/bad.ts", "src/f.ts");
    expect(r.status).toBe(1);
    const [bad, ok] = lines(r.stdout);
    expect(bad).toMatchObject({ outcome: "refused", reason: "annotation" });
    expect(bad!.message).toMatch(/^src\/bad\.ts:1: @ensures\{p\}: /);
    expect(ok).toMatchObject({ outcome: "program" });
  });
});

describe("lemma parse: no emission", () => {
  it("documents a script with no emission", () => {
    const r = invoke("parse", fixture("arithmetic.js"));
    expect(parsed(r.stdout)).not.toHaveProperty("emission");
  });
});

describe("lemma check: an ill-typed project", () => {
  useTempProject("lemma-cli-ill-", {
    "src/a.ts": "export const a: number = 'one';\n",
    "src/b.ts": "export const b = 1;\n",
  });

  it("refuses every file, each with the gate's diagnostics", () => {
    const r = invoke("check", "--jsonl", "src/a.ts", "src/b.ts");
    expect(r.status).toBe(1);
    const ds = lines(r.stdout);
    for (const d of ds) expect(d).toMatchObject({ reason: "typecheck" });
    expect(ds[1]!.diagnostics).toEqual([
      expect.objectContaining({ file: "src/a.ts", line: 1, code: 2322 }),
    ]);
  });
});

describe("lemma check: no tsconfig.json", () => {
  useTempProject(
    "lemma-cli-none-",
    { "a.ts": "export const a = 1;\n" },
    { tsconfig: false },
  );

  it("refuses the file rather than inventing options", () => {
    const r = invoke("check", "a.ts");
    expect(r.status).toBe(1);
    expect(parsed(r.stdout)).toMatchObject({ reason: "no-tsconfig" });
  });
});

describe("lemma usage", () => {
  for (const argv of [
    [],
    ["lint", "a.ts"],
    ["parse"],
    ["parse", "a.js", "b.js"],
    ["parse", "--tsbuildinfo", "x", "a.js"],
    ["check", "--bogus", "a.ts"],
  ]) {
    it(`refuses ${JSON.stringify(argv)} with exit 2 and no stdout`, () => {
      const r = invoke(...argv);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("usage: lemma check");
    });
  }

  it("prints help on -h", () => {
    const r = invoke("-h");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("lemma parse [--jsonl]");
  });
});

// The built file, run the way a person runs it. The build is the
// suite-wide globalSetup's.
describe("lemma/dist/cli.js", () => {
  const cli = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
    "cli.js",
  );

  it("starts with an env-node shebang", () => {
    expect(readFileSync(cli, "utf8").split("\n", 1)[0]).toBe(
      "#!/usr/bin/env node",
    );
  });

  it("runs main() when node executes it", () => {
    const r = spawnSync(
      process.execPath,
      [cli, "parse", fixture("numeric-loop.js")],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).program).toEqual(
      golden("numeric-loop.estree.json"),
    );
  });
});
