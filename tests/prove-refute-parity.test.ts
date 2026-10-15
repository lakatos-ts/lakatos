import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  proveTimeoutMs,
  runBin,
  runBinForEnvelope,
  runThales,
  useRepoScratchDir,
  useTempProject,
} from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";
import type { Envelope } from "@lakatos/core/envelope";
import { main as refuteMain } from "../pabst/src/cli.js";
import { COMPILE_ERROR_CASES } from "../pabst/tests/helpers/compile-error-cases.js";

// Prove and refute over the same files, through the Lean thales binary and
// the pabst bin: the one place both engines run side by side. The binary
// needs the Lean toolchain, so all of it is gated like the prove e2e.
const enabled = process.env.LAKATOS_PROVE_E2E === "1";

const repoRoot = process.cwd();
const conformance = path.join(repoRoot, "thales", "tests", "conformance");

let built = false;
function buildThales(): void {
  if (built) return;
  execFileSync("lake", ["build", "thales"], {
    cwd: path.join(repoRoot, "thales"),
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 600_000,
  });
  built = true;
}

/** The binary's single-envelope contract, as runBinForEnvelope applies it
 * to a bin's main(). */
async function runThalesForEnvelope(
  argv: string[],
  expectedCode = 0,
): Promise<Envelope> {
  const run = await runThales(argv);
  expect(run.code, run.stderr.join("\n")).toBe(expectedCode);
  expect(run.stdout).toHaveLength(1);
  const env = JSON.parse(run.stdout[0]!) as Envelope;
  expectValidEnvelope(env);
  return env;
}

describe.runIf(enabled)("prove and refute report compile errors alike", () => {
  beforeAll(buildThales, 600_000);
  useTempProject(
    "lakatos-parity-err-",
    Object.fromEntries(COMPILE_ERROR_CASES.map((c) => [c.file, c.source])),
  );

  it.each(COMPILE_ERROR_CASES.filter((c) => c.parseLevel))(
    "prove on $name exits 2 with the same diagnostic as refute",
    async (c) => {
      const refute = await runBin(refuteMain, [c.file]);
      const prove = await runThales([c.file]);
      expect(prove.code).toBe(2);
      expect(refute.code).toBe(2);
      expect(prove.stdout).toEqual(refute.stdout);
      expect(prove.stderr).toEqual(refute.stderr.flatMap((s) => s.split("\n")));
    },
  );
});

describe.runIf(enabled)("prove and refute agree", () => {
  beforeAll(buildThales, 600_000);
  // Verdicts, not models: one heartbeat keeps each correspondence proof to
  // milliseconds.
  beforeEach(() => {
    vi.stubEnv("LAKATOS_PROVE_VALIDATE_HEARTBEATS", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  useRepoScratchDir(path.join(repoRoot, ".lakatos", "parity-work"), (dir) => {
    // The identity-parity check needs a file BOTH engines can process end
    // to end (the tracer carries constructs the model refuses), so it
    // reuses the corpus's add-commutes fixture.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "add-commutes.ts",
      ),
      path.join(dir, "parity.ts"),
    );
    fs.copyFileSync(
      path.join(conformance, "countersatisfiable", "boolean-witness.ts"),
      path.join(dir, "boolwit.ts"),
    );
    // Engine parity on a finite domain: the prover decides it, the
    // refuter walks it, and both say Theorem.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "endpoints.ts",
      ),
      path.join(dir, "small.ts"),
    );
    // Engine parity over a class binder whose constructor takes a boolean:
    // the prover proves it over the constructor's image, the refuter
    // enumerates the two constructions, and both say Theorem.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "boolean-classes.ts",
      ),
      path.join(dir, "flag.ts"),
    );
  });

  it(
    "prove and refute report identical identity keys for the same file",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const proveEnv = await runThalesForEnvelope(["parity.ts"]);
      expect(proveEnv.annotations[0]).toMatchObject({ szs: "Theorem" });

      const refuteEnv = await runBinForEnvelope(refuteMain, ["parity.ts"]);

      const ids = (e: Envelope) =>
        e.annotations.map((a) => [a.file, a.function, a.property]).sort();
      expect(ids(proveEnv)).toEqual([["parity.ts", "add", "commutes"]]);
      expect(ids(proveEnv)).toEqual(ids(refuteEnv));
    },
  );

  it(
    "a boolean binder's witness is the same assignment under both engines",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const proveEnv = await runThalesForEnvelope(["boolwit.ts"], 1);
      const refuteEnv = await runBinForEnvelope(refuteMain, ["boolwit.ts"], 1);
      const witnesses = (e: Envelope) =>
        e.annotations
          .map((a) => [a.property, a.counterexample] as const)
          .sort(([p], [q]) => p.localeCompare(q));
      expect(witnesses(proveEnv)).toEqual([
        ["alwaysPicks", { n: 1, b: false }],
        ["onlyOff", { b: true }],
      ]);
      expect(witnesses(refuteEnv)).toEqual(witnesses(proveEnv));
    },
  );

  it(
    "prove and refute both report Theorem on a small finite domain",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const proveEnv = await runThalesForEnvelope(["small.ts"]);
      const refuteEnv = await runBinForEnvelope(refuteMain, ["small.ts"]);
      const by = (e: Envelope) =>
        new Map(e.annotations.map((a) => [`${a.function}/${a.property}`, a]));
      const proved = by(proveEnv);
      const walked = by(refuteEnv);
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
    { timeout: proveTimeoutMs(1) },
    async () => {
      const proveEnv = await runThalesForEnvelope(["flag.ts"]);
      const refuteEnv = await runBinForEnvelope(refuteMain, ["flag.ts"]);
      const by = (e: Envelope) =>
        new Map(e.annotations.map((a) => [`${a.function}/${a.property}`, a]));
      const proved = by(proveEnv);
      const walked = by(refuteEnv);
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
