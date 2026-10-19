import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";

// Prove and refute over the same files, each engine run as a bin: the one
// place both run side by side. Never a required check: the scheduled
// `parity` workflow runs it, so no engine's merge waits on the other's.
// `LAKATOS_THALES` and `LAKATOS_PABST` name the bins; both default to this
// checkout's builds.

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const thalesBin =
  process.env.LAKATOS_THALES ??
  path.join(repoRoot, "thales", ".lake", "build", "bin", "thales");
const pabstBin =
  process.env.LAKATOS_PABST ?? path.join(repoRoot, "pabst", "dist", "cli.js");

/** thales's budgets: one `lake build`, and one Lean run per artifact. */
const BUILD_TIMEOUT_MS = 600_000;
const LEAN_TIMEOUT_MS = 300_000;
const TIMEOUT_MS = BUILD_TIMEOUT_MS + 2 * LEAN_TIMEOUT_MS + 60_000;

interface Annotation {
  file: string;
  function: string;
  property: string;
  szs: string;
  [field: string]: unknown;
}
interface Envelope {
  annotations: Annotation[];
}
interface Run {
  code: number;
  stdout: string[];
  stderr: string[];
}

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(
  JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "spec", "envelope.schema.json"),
      "utf8",
    ),
  ),
);

function run(bin: string, argv: string[]): Run {
  // A built `.js` bin runs under this node; an installed one is executable.
  const [cmd, args] = bin.endsWith(".js")
    ? [process.execPath, [bin, ...argv]]
    : [bin, argv];
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { LAKATOS_LEMMA: path.join(repoRoot, "lemma"), ...process.env },
    timeout: TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return {
    code: r.status ?? -1,
    stdout: r.stdout.trim() === "" ? [] : [r.stdout.trimEnd()],
    stderr: r.stderr === "" ? [] : r.stderr.trimEnd().split("\n"),
  };
}

/** The single-envelope contract: the expected exit code, one stdout line,
 * and that line a schema-valid envelope. */
function envelope(bin: string, file: string, expectedCode = 0): Envelope {
  const r = run(bin, [file]);
  expect(r.code, r.stderr.join("\n")).toBe(expectedCode);
  expect(r.stdout).toHaveLength(1);
  const env: unknown = JSON.parse(r.stdout[0]!);
  if (!validate(env))
    expect.fail(`envelope failed schema validation: ${ajv.errorsText()}`);
  return env as Envelope;
}

const prove = (file: string, code?: number) => envelope(thalesBin, file, code);
const refute = (file: string, code?: number) => envelope(pabstBin, file, code);

/** The tsconfig a scratch project gets: enough for tsc to describe the
 * program, with the run root excluded so generated artifacts never join it. */
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

/** chdir into `dir`, populated, for the enclosing describe block. */
function useProject(dir: string, populate: (dir: string) => void): void {
  const prevCwd = process.cwd();
  beforeAll(() => {
    for (const bin of [thalesBin, pabstBin])
      expect(fs.existsSync(bin), `${bin} is missing; build it first`).toBe(
        true,
      );
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    populate(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG, "utf8");
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

/** Rejects lemma's own parsers throw, which both engines must refuse alike. */
const COMPILE_ERRORS: { name: string; file: string; source: string }[] = [
  {
    name: "a malformed quantifier prefix",
    file: "malformed.ts",
    source: `/** @ensures{shapely} for every (n: nat), malformed(n) >= 0 */\nexport function malformed(n: number): number { return n; }\n`,
  },
  {
    name: "a leading existential quantifier",
    file: "existential.ts",
    source: `/** @ensures{someone} exists (n: nat), ex(n) > 0 */\nexport function ex(n: number): number { return n; }\n`,
  },
  {
    name: "an existential inside the body",
    file: "bodyexists.ts",
    source: `/** @ensures{someInBody} forall (n: nat) { inBody(n) > 0 ∧ exists m, inBody(m) === 0 } */\nexport function inBody(n: number): number { return n; }\n`,
  },
  {
    name: "a nested forall inside the body",
    file: "nestedforall.ts",
    source: `/** @ensures{deep} forall (n: nat) { forall (m: nat) { nested(n) >= 0 } } */\nexport function nested(n: number): number { return n; }\n`,
  },
  {
    name: "JS && at the property's top level",
    file: "jsconj.ts",
    source: `/** @ensures{conj} forall (n: nat) { jsconj(n) >= 0 && jsconj(n) >= 0 } */\nexport function jsconj(n: number): number { return n; }\n`,
  },
  {
    name: "a comma-separated binder group",
    file: "commagroup.ts",
    source: `/** @ensures{p} forall (a: number, b: number) { 0 <= commagroup(a) } */\nexport function commagroup(a: number, b: number): number { return a; }\n`,
  },
];

describe("prove and refute report compile errors alike", () => {
  useProject(
    fs.mkdtempSync(path.join(os.tmpdir(), "lakatos-parity-err-")),
    (dir) => {
      for (const c of COMPILE_ERRORS)
        fs.writeFileSync(path.join(dir, c.file), c.source, "utf8");
    },
  );

  it.each(COMPILE_ERRORS)(
    "prove on $name exits 2 with the same diagnostic as refute",
    { timeout: TIMEOUT_MS },
    (c) => {
      const refuted = run(pabstBin, [c.file]);
      const proved = run(thalesBin, [c.file]);
      expect(proved.code).toBe(2);
      expect(refuted.code).toBe(2);
      expect(proved.stdout).toEqual(refuted.stdout);
      expect(proved.stderr).toEqual(refuted.stderr);
    },
  );
});

describe("prove and refute agree", () => {
  // Inside the repo: refute's generated tests import "@lakatos/pabst/runtime"
  // through the workspace link, which os.tmpdir() cannot reach.
  useProject(path.join(repoRoot, ".lakatos", "parity-work"), (dir) => {
    for (const f of fs.readdirSync(path.join(here, "fixtures")))
      fs.copyFileSync(path.join(here, "fixtures", f), path.join(dir, f));
  });

  // Verdicts, not models: one heartbeat keeps each correspondence proof to
  // milliseconds.
  beforeAll(() => {
    process.env.LAKATOS_PROVE_VALIDATE_HEARTBEATS = "1";
  });
  afterAll(() => {
    delete process.env.LAKATOS_PROVE_VALIDATE_HEARTBEATS;
  });

  const by = (e: Envelope) =>
    new Map(e.annotations.map((a) => [`${a.function}/${a.property}`, a]));

  it(
    "prove and refute report identical identity keys for the same file",
    { timeout: TIMEOUT_MS },
    () => {
      const proved = prove("parity.ts");
      expect(proved.annotations[0]).toMatchObject({ szs: "Theorem" });
      const ids = (e: Envelope) =>
        e.annotations.map((a) => [a.file, a.function, a.property]).sort();
      expect(ids(proved)).toEqual([["parity.ts", "add", "commutes"]]);
      expect(ids(refute("parity.ts"))).toEqual(ids(proved));
    },
  );

  it(
    "a boolean binder's witness is the same assignment under both engines",
    { timeout: TIMEOUT_MS },
    () => {
      const witnesses = (e: Envelope) =>
        e.annotations
          .map((a) => [a.property, a.counterexample] as const)
          .sort(([p], [q]) => p.localeCompare(q));
      const proved = witnesses(prove("boolwit.ts", 1));
      expect(proved).toEqual([
        ["alwaysPicks", { n: 1, b: false }],
        ["onlyOff", { b: true }],
      ]);
      expect(witnesses(refute("boolwit.ts", 1))).toEqual(proved);
    },
  );

  it(
    "prove and refute both report Theorem on a small finite domain",
    { timeout: TIMEOUT_MS },
    () => {
      const proved = by(prove("small.ts"));
      const walked = by(refute("small.ts"));
      expect([...proved.keys()].sort()).toEqual([
        "keep/positive",
        "shift/bounded",
      ]);
      expect([...walked.keys()].sort()).toEqual([...proved.keys()].sort());
      for (const key of proved.keys()) {
        expect(proved.get(key)).toMatchObject({ szs: "Theorem", axioms: [] });
      }
      expect(walked.get("keep/positive")).toMatchObject({
        szs: "Theorem",
        kind: "enumerated",
        cases: 8,
      });
      expect(walked.get("shift/bounded")).toMatchObject({
        szs: "Theorem",
        kind: "enumerated",
        cases: 9,
      });
    },
  );

  it(
    "prove and refute agree on a class binder over a boolean constructor parameter",
    { timeout: TIMEOUT_MS },
    () => {
      const proved = by(prove("flag.ts"));
      const walked = by(refute("flag.ts"));
      expect([...walked.keys()].sort()).toEqual([...proved.keys()].sort());
      for (const key of ["Flag#level/reads", "pick/branches"]) {
        expect(proved.get(key)).toMatchObject({ szs: "Theorem", axioms: [] });
        expect(walked.get(key)).toMatchObject({
          szs: "Theorem",
          kind: "enumerated",
          cases: 2,
        });
      }
    },
  );
});
