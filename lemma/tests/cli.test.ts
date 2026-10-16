import { describe, it, expect, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { admit, refusalsOf } from "../src/admit.js";
import { main } from "../src/cli.js";
import { extract } from "../src/extract.js";
import {
  admittedDocument,
  checkDocuments,
  type DocumentAnnotation,
} from "../src/document.js";
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
    expect(r.stdout).toMatch(/^\{\n {2}"schemaVersion": 1,/);
    const d = JSON.parse(r.stdout);
    validate(d);
    expect(d).toEqual({
      schemaVersion: 1,
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

  it("a missing file matches nothing, as a pattern would", () => {
    const r = invoke("check", "--jsonl", "src/nope.ts");
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("no matching .ts files\n");
  });

  it("a missing file handed to checkDocuments is outside the program, with nothing to refuse", () => {
    const [d] = checkDocuments(["src/nope.ts"]);
    expect(d).toMatchObject({
      file: "src/nope.ts",
      outcome: "refused",
      reason: "outside-program",
      annotations: [],
    });
    validate(d);
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

  it("carries the annotations with their outcomes, version 1", () => {
    const r = invoke("check", "src/f.ts");
    const d = parsed(r.stdout);
    expect(d.schemaVersion).toBe(1);
    expect(d.annotations).toEqual([
      { function: "f", property: "id", line: 1, outcome: "tried" },
    ]);
  });

  it("a parse document carries no annotations", () => {
    const r = invoke("parse", fixture("arithmetic.js"));
    expect(parsed(r.stdout)).not.toHaveProperty("annotations");
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
      JSON.parse(
        JSON.stringify(admittedDocument("src/f.ts", new Map()).document),
      ),
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
      obligations(admittedDocument("src/typo.ts", new Map()).document.emission),
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
    const second = lines(r.stdout)[1]!.annotations as {
      property: string;
      error?: string;
    }[];
    expect(second.find((a) => a.property === "bad")!.error).toMatch(
      /^\.\/src\/typo\.ts:3:/,
    );
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

describe("lemma/dist/cli.js: a slow reader", () => {
  const cli = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "dist",
    "cli.js",
  );
  const count = 160;
  const files = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `src/f${i}.ts`,
      "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x } */\n" +
        "export function f(x: number): number { return x; }\n",
    ]),
  );
  const dir = useTempProject("lemma-cli-drain-", files);

  // Past the pipe buffer, the bin must wait for the reader before exiting.
  it("gets every document through a pipe the reader leaves full", async () => {
    const child = spawn(process.execPath, [cli, "check", "--jsonl"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const closed = new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    // The listener goes on first: a child that exits with its stdout
    // unread otherwise has that output discarded by this end.
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stdout.pause();
    await new Promise((r) => setTimeout(r, 1000));
    child.stdout.resume();
    const status = await closed;
    expect(stdout.length).toBeGreaterThan(64 * 1024);
    expect(status).toBe(0);
    expect(lines(stdout).map((d) => d.file)).toEqual(Object.keys(files).sort());
  }, 20_000);
});

type Refusal = {
  file: unknown;
  function: string;
  property: string;
  error: string;
};

const refusalKey = (r: Refusal) =>
  JSON.stringify([r.file, r.function, r.property, r.error]);

describe("lemma check: refusal causes", () => {
  useTempProject("lemma-cli-causes-", {
    "src/typo.ts":
      "function h(x: number): number { return x; }\n" +
      "/** @ensures{id} forall (x: int ∈ [0, 5)) { f(x) === x }\n" +
      " *  @ensures{bad} forall (x: int ∈ [0, 5)) { h(x) === x } */\n" +
      "export function f(x: number): number { return h(x); }\n",
    "src/dup.ts":
      "/** @ensures{p} forall (x: int ∈ [0, 5)) { g(x) === x }\n" +
      " *  @ensures{p} forall (x: int ∈ [0, 5)) { g(x) === x } */\n" +
      "export function g(x: number): number { return x; }\n",
    "src/async.ts":
      "/** @ensures{p} forall (x: int ∈ [0, 5)) { a(x) !== undefined } */\n" +
      "export async function a(x: number): Promise<number> { return x; }\n",
    "outside.mts":
      "/** @ensures{p} forall (x: int ∈ [0, 5)) { o(x) >= 0 } */\n" +
      "export function o(x: number): number { return x; }\n",
  });

  it("a typing refusal names its cause and admit's error text", () => {
    const d = parsed(invoke("check", "src/typo.ts").stdout);
    expect(d.annotations).toEqual([
      { function: "f", property: "id", line: 2, outcome: "tried" },
      {
        function: "f",
        property: "bad",
        line: 3,
        outcome: "refused",
        cause: "typing",
        error: expect.stringMatching(/^src\/typo\.ts:3: /),
      },
    ]);
  });

  it("an extraction refusal follows the extracted annotations", () => {
    const d = parsed(invoke("check", "src/dup.ts").stdout);
    const outcomes = (
      d.annotations as { outcome: string; cause?: string }[]
    ).map((a) => [a.outcome, a.cause]);
    expect(outcomes[outcomes.length - 1]).toEqual(["refused", "extraction"]);
    expect(outcomes.filter(([o]) => o === "refused")).toHaveLength(1);
  });

  it("a classified annotation carries the emitter's szs and reason", () => {
    const d = parsed(invoke("check", "src/async.ts").stdout);
    expect(d.annotations).toEqual([
      {
        function: "a",
        property: "p",
        line: 1,
        outcome: "classified",
        szs: "Inappropriate",
        reason: expect.stringContaining("AsyncKeyword"),
      },
    ]);
  });

  it("a file outside the program refuses every annotation at the gate", () => {
    const d = parsed(invoke("check", "outside.mts").stdout);
    expect(d).toMatchObject({ outcome: "refused", reason: "outside-program" });
    expect(d.annotations).toEqual([
      {
        function: "o",
        property: "p",
        line: 1,
        outcome: "refused",
        cause: "gate",
        error:
          "outside.mts is not part of the program tsconfig.json describes, so it was not type checked",
      },
    ]);
  });

  it("the refused annotations are admit's refusals, with admit's text", () => {
    const files = ["src/typo.ts", "src/dup.ts", "outside.mts"];
    const a = admit(files, ".lakatos/tc", () => {});
    const docs = lines(invoke("check", "--jsonl", ...files).stdout);
    const fromDocs = docs.flatMap((d) =>
      (d.annotations as (DocumentAnnotation & { error?: string })[])
        .filter((x) => x.outcome === "refused")
        .map((x) => ({
          file: d.file,
          function: x.function,
          property: x.property,
          error: x.error!,
        })),
    );
    expect(a.kind).toBe("admitted");
    const expected = [
      ...(a as { refusals: Refusal[] }).refusals,
      ...files.flatMap(extractRefusals),
    ];
    expect(fromDocs.map(refusalKey).sort()).toEqual(
      expected.map(refusalKey).sort(),
    );
  });
});

function extractRefusals(file: string): Refusal[] {
  return refusalsOf(file, extract(file).invalid);
}

describe("lemma check: an ill-typed project refuses every annotation", () => {
  useTempProject("lemma-cli-ill-annot-", {
    "src/a.ts":
      "export const a: number = 'one';\n" +
      "/** @ensures{p} forall (x: int ∈ [0, 5)) { f(x) >= 0 } */\n" +
      "export function f(x: number): number { return x; }\n",
    "src/b.ts":
      "/** @ensures{q} forall (x: int ∈ [0, 5)) { g(x) >= 0 }\n" +
      " *  @ensures{p} forall (x: int ∈ [0, 5)) { g(x) >= 0 }\n" +
      " *  @ensures{p} forall (x: int ∈ [0, 5)) { g(x) >= 0 } */\n" +
      "export function g(x: number): number { return x; }\n",
  });

  it("gate refusals first with the typecheck message, then extraction", () => {
    const [a, b] = lines(
      invoke("check", "--jsonl", "src/a.ts", "src/b.ts").stdout,
    );
    expect(a!.annotations).toEqual([
      {
        function: "f",
        property: "p",
        line: 2,
        outcome: "refused",
        cause: "gate",
        error: expect.stringMatching(
          /^the program does not type check: src\/a\.ts:1: TS2322: /,
        ),
      },
    ]);
    const bs = b!.annotations as { cause: string }[];
    expect(bs.map((x) => x.cause)).toEqual(["gate", "extraction"]);
  });
});

describe("lemma check: no tsconfig refuses every annotation", () => {
  useTempProject(
    "lemma-cli-none-annot-",
    {
      "a.ts":
        "/** @ensures{p} forall (x: int ∈ [0, 5)) { f(x) >= 0 } */\n" +
        "export function f(x: number): number { return x; }\n",
    },
    { tsconfig: false },
  );

  it("names the cause gate with admit's no-tsconfig message", () => {
    const d = parsed(invoke("check", "a.ts").stdout);
    expect(d.annotations).toEqual([
      {
        function: "f",
        property: "p",
        line: 1,
        outcome: "refused",
        cause: "gate",
        error:
          "no tsconfig.json: lakatos type checks the program before analyzing it and needs the project's compiler options to do so",
      },
    ]);
  });
});

describe("lemma check: discovery and globs", () => {
  useTempProject("lemma-cli-discover-", {
    "src/a.ts": "export const a = 1;\n",
    "src/b.ts": "export const b = 2;\n",
    "src/types.d.ts": "export declare const t: number;\n",
  });

  it("an existing file is answered under the spelling it was given", () => {
    const r = invoke("check", "--jsonl", "./src/a.ts");
    expect(r.status).toBe(0);
    expect(lines(r.stdout).map((d) => d.file)).toEqual(["./src/a.ts"]);
  });

  it("with no files, checks the files tsconfig.json compiles", () => {
    const r = invoke("check", "--jsonl");
    expect(r.status).toBe(0);
    expect(lines(r.stdout).map((d) => d.file)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("expands a glob and drops declaration files", () => {
    const r = invoke("check", "--jsonl", "src/**/*.ts");
    expect(r.status).toBe(0);
    expect(lines(r.stdout).map((d) => d.file)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("a pattern matching nothing is the message on stderr and exit 2", () => {
    const r = invoke("check", "--jsonl", "nope/**/*.ts");
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("no matching .ts files\n");
  });

  it("without --jsonl a pattern must name exactly one file", () => {
    const r = invoke("check", "src/*.ts");
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^usage: lemma check/);
  });
});
