import { describe, it, expect } from "vitest";
import { runMain, useTempProject } from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";
import { COMPILE_ERROR_CASES } from "../pabst/tests/helpers/compile-error-cases.js";

describe("cli main", () => {
  useTempProject("lakatos-cli-", {
    "baz.ts": `/** @ensures{pos} forall (n: nat) { baz(n) >= 0 } */\nexport function baz(n: number): number { return n; }\n`,
    "shadow.d.ts": `/** @ensures{pos2} forall (n: nat) { baz(n) >= 0 } */\nexport declare function baz(n: number): number;\n`,
  });

  it("skips declaration files matched by a glob", async () => {
    const { code, stdout } = await runMain(["check", "*.ts"]);
    expect(code).toBe(1);
    const env = JSON.parse(stdout[0]!);
    expect(env.annotations).toHaveLength(1);
    expect(env.annotations[0]).toMatchObject({ file: "baz.ts" });
  });

  it("honors an explicitly named declaration file", async () => {
    const { code, stdout } = await runMain(["check", "shadow.d.ts"]);
    expect(code).toBe(1);
    const env = JSON.parse(stdout[0]!);
    expect(env.annotations).toHaveLength(1);
    expect(env.annotations[0]).toMatchObject({ property: "pos2" });
  });

  it("honors a glob that targets declaration files", async () => {
    const { code, stdout } = await runMain(["check", "*.d.ts"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout[0]!).annotations).toHaveLength(1);
  });

  it("returns 2 on unknown command", async () => {
    const { code, stderr } = await runMain(["frobnicate", "baz.ts"]);
    expect(code).toBe(2);
    expect(stderr[0]).toContain("usage: lakatos");
  });

  it("returns 2 with usage on an unknown option", async () => {
    const { code, stderr } = await runMain(["--halp"]);
    expect(code).toBe(2);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain("usage: lakatos");
  });

  it("prints help on --help and exits 0", async () => {
    const { code, stdout, stderr } = await runMain(["--help"]);
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    const help = stdout.join("\n");
    expect(help).toContain("usage: lakatos");
    expect(help).toContain("prove");
    expect(help).toContain("refute");
    expect(help).toContain("check");
    expect(help).toContain("exe");
    expect(help).toContain("--seed");
    expect(help).toContain("--help");
    // exe's two honesty limits are stated where the verb is, not only in
    // the README: a proof's model is checked against the evaluator one
    // declaration at a time, and refute runs somewhere else entirely.
    expect(help).toContain("checked against the\nevaluator per declaration");
    expect(help).toContain("refute runs on Node");
  });

  it("prints the same help on -h", async () => {
    const { code, stdout } = await runMain(["-h"]);
    expect(code).toBe(0);
    expect(stdout).toEqual((await runMain(["--help"])).stdout);
  });

  it("returns 2 when no .ts files match the patterns", async () => {
    expect((await runMain(["check", "*.nope"])).code).toBe(2);
  });
});

describe("cli main without a tsconfig", () => {
  useTempProject(
    "lakatos-cli-nodiscover-",
    {
      "baz.ts": `/** @ensures{pos} forall (n: nat) { baz(n) >= 0 } */\nexport function baz(n: number): number { return n; }\n`,
    },
    { tsconfig: false },
  );

  it("returns 2 when no patterns are given and nothing is discoverable", async () => {
    const { code, stderr } = await runMain(["check"]);
    expect(code).toBe(2);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toBe(
      'error: no tsconfig.json to discover sources from; pass files or globs (e.g. lakatos refute "src/**/*.ts")',
    );
  });
});

describe("cli input errors", () => {
  useTempProject("lakatos-cli-inputerror-", {
    "mixed.ts": `class Hidden {
  /** @ensures{p} forall (x: int) { Hidden.id(x) === x } */
  static id(x: number): number { return x; }
}

/** @ensures{q} forall (x: int ∈ [0, 5)) { ok(x) === x } */
export function ok(x: number): number { return x; }
`,
  });

  it("check stub reports InputError entries beside NotTried and exits 2", async () => {
    const { code, stdout, stderr } = await runMain(["check", "mixed.ts"]);
    expect(code).toBe(2);
    const env = JSON.parse(stdout[0]!);
    expectValidEnvelope(env);
    expect(env.annotations).toContainEqual({
      file: "mixed.ts",
      function: "Hidden.id",
      property: "p",
      szs: "InputError",
      error: expect.stringMatching(/^mixed\.ts:2: .*not exported/),
    });
    expect(env.annotations).toContainEqual({
      file: "mixed.ts",
      function: "ok",
      property: "q",
      szs: "NotTried",
    });
    expect(stderr.join("\n")).toContain("mixed.ts:2: ");
    expect(stderr.join("\n")).toContain("not exported");
  });
});
describe("cli compile errors (exit-code contract)", () => {
  useTempProject(
    "lakatos-cli-err-",
    Object.fromEntries(COMPILE_ERROR_CASES.map((c) => [c.file, c.source])),
  );

  const PARSE_LEVEL_CASES = COMPILE_ERROR_CASES.filter((c) => c.parseLevel);

  it.each(PARSE_LEVEL_CASES)(
    "prove on $name exits 2 with the same diagnostic as refute",
    async (c) => {
      const refute = await runMain(["refute", c.file]);
      const prove = await runMain(["prove", c.file]);
      expect(prove.code).toBe(2);
      expect(prove.stdout).toEqual(refute.stdout);
      expect(prove.stderr).toEqual(refute.stderr);
    },
  );
});
