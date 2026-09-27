import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  proveTimeoutMs,
  runForEnvelope,
  useRepoScratchDir,
} from "./helpers/cli.js";
import { square } from "./conformance/countersatisfiable/zero-edge.js";
import { f } from "./conformance/countersatisfiable/commutes.js";

// Needs the Lean toolchain and is minutes-slow, so it only runs when asked:
// thales.yml sets the variable; unit and coverage runs stay identical
// everywhere by never running it implicitly.
const enabled = process.env.LAKATOS_PROVE_E2E === "1";

const repoRoot = process.cwd();

describe.runIf(enabled)("thales end-to-end (tracer)", () => {
  // The e2e grades verdicts, not models, and a correspondence proof at the
  // real budget costs about half a minute per declaration. One heartbeat
  // makes every declaration report the budget reason in milliseconds;
  // check:verdict-channel exercises the real budget.
  beforeEach(() => {
    vi.stubEnv("LAKATOS_PROVE_VALIDATE_HEARTBEATS", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  useRepoScratchDir(path.join(repoRoot, ".lakatos", "e2e-work"), (dir) => {
    fs.copyFileSync(
      path.join(repoRoot, "thales", "tests", "fixtures", "tracer.ts"),
      path.join(dir, "tracer.ts"),
    );
    // The witness round-trip runs the corpus's false fixtures and then
    // evaluates their functions (imported above) at the extracted witness.
    const cs = path.join(
      repoRoot,
      "thales",
      "tests",
      "conformance",
      "countersatisfiable",
    );
    fs.copyFileSync(path.join(cs, "zero-edge.ts"), path.join(dir, "unique.ts"));
    fs.copyFileSync(path.join(cs, "commutes.ts"), path.join(dir, "comm.ts"));
    // The symbolic rungs' flagship: guarded monotonicity of the linear
    // conversion, chained from the four Float monotonicity facts.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "guarded-monotone-conversion.ts",
      ),
      path.join(dir, "conversion.ts"),
    );
    // The non-negativity chain's flagship: sqrt of a square.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "sqrt-sum-sq-nonneg.ts",
      ),
      path.join(dir, "sq.ts"),
    );
    // Guard refutation: the binder's bounds rule out the throwing arms.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "thales",
        "tests",
        "conformance",
        "theorem",
        "guarded-sqrt.ts",
      ),
      path.join(dir, "guards.ts"),
    );
    // The class-binder flagship (Point#distance non-negativity), pinned at
    // today's honest refusal; class modeling landing flips this to Theorem.
    fs.copyFileSync(
      path.join(
        repoRoot,
        "lemma",
        "spec",
        "fixtures",
        "binder",
        "accept",
        "class-binder.ts",
      ),
      path.join(dir, "point.ts"),
    );
  });

  it(
    "one healthy run: Theorem and Inappropriate per annotation",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const env = await runForEnvelope(["tracer.ts"]);

      const by = new Map(
        env.annotations.map((a) => [`${a.function}/${a.property}`, a]),
      );
      // One heartbeat: the closer's budget reason reaches the envelope
      // verbatim, so the store and the field pin the engine's wording.
      expect(by.get("add/commutes")).toMatchObject({
        szs: "Theorem",
        model: {
          status: "unvalidated",
          reason: "budget: the attempt exceeded thales.validateHeartbeats = 1",
        },
      });
      // A frontend classification never reached Lean, so no obligation was
      // run for it and the envelope says nothing about its model.
      expect(by.get("fetchTotal/nonNegative")).not.toHaveProperty("model");
      expect(by.get("fetchTotal/nonNegative")).toMatchObject({
        szs: "Inappropriate",
        reason: expect.stringContaining("AsyncKeyword"),
      });
      expect(by.get("Counter#bump/bumps")).toMatchObject({
        szs: "Inappropriate",
        reason: expect.stringContaining(
          "class 'Counter' has no constructor implementation to model",
        ),
      });
      expect(env.annotations).toHaveLength(3);
    },
  );

  it(
    "the tracer's add validates its model at the real budget",
    { timeout: proveTimeoutMs(1) },
    async () => {
      // 0 is not a budget and is ignored, so this is the default one: the
      // correspondence proof the issue's example shows, end to end.
      vi.stubEnv("LAKATOS_PROVE_VALIDATE_HEARTBEATS", "0");
      const env = await runForEnvelope(["tracer.ts"]);
      const add = env.annotations.find(
        (a) => `${a.function}/${a.property}` === "add/commutes",
      );
      expect(add).toMatchObject({
        szs: "Theorem",
        axioms: [],
        model: { status: "validated" },
      });
    },
  );

  it(
    "false bounded claims ship witnesses that round-trip against the source",
    { timeout: proveTimeoutMs(2) },
    async () => {
      // Counterexamples found: the documented exit 1.
      const env = await runForEnvelope(["unique.ts", "comm.ts"], 1);
      const by = new Map(
        env.annotations.map((a) => [`${a.function}/${a.property}`, a]),
      );

      // square(x) > 0 over [0, 10) is false only at x = 0, so the witness
      // is fully pinned — and evaluating the source at it falsifies.
      expect(by.get("square/positive")).toMatchObject({
        szs: "CounterSatisfiable",
        kind: "falsified",
        counterexample: { x: 0 },
      });
      expect(square(0) > 0).toBe(false);

      // Commutativity fails at any a ≠ b, so assert shape and bounds, then
      // round-trip the witness through the fixture's own function.
      const comm = by.get("f/commutes")!;
      expect(comm).toMatchObject({
        szs: "CounterSatisfiable",
        kind: "falsified",
      });
      const cex = comm.counterexample as Record<string, number>;
      expect(Object.keys(cex).sort()).toEqual(["a", "b"]);
      for (const v of Object.values(cex)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(10);
      }
      expect(f(cex.a!, cex.b!)).not.toBe(f(cex.b!, cex.a!));
    },
  );

  it(
    "guarded monotonicity of the conversion proves without axioms",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const env = await runForEnvelope(["conversion.ts"]);
      expect(env.annotations).toHaveLength(1);
      expect(env.annotations[0]).toMatchObject({
        function: "applyConversionFactors",
        property: "monotone",
        szs: "Theorem",
        axioms: [],
      });
    },
  );

  it(
    "the non-negativity chain proves without axioms",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const env = await runForEnvelope(["sq.ts"]);
      expect(env.annotations).toHaveLength(1);
      expect(env.annotations[0]).toMatchObject({
        function: "root",
        property: "nonNeg",
        szs: "Theorem",
        axioms: [],
      });
    },
  );

  it(
    "bounds refute the guards' throwing arms without axioms",
    { timeout: proveTimeoutMs(2) },
    async () => {
      const env = await runForEnvelope(["guards.ts"]);
      expect(env.annotations).toHaveLength(2);
      for (const a of env.annotations) {
        expect(a).toMatchObject({ szs: "Theorem", axioms: [] });
      }
    },
  );

  it(
    "the class-valued Point binder proves over the constructor's image",
    { timeout: proveTimeoutMs(1) },
    async () => {
      const env = await runForEnvelope(["point.ts"]);
      expect(env.annotations).toHaveLength(1);
      expect(env.annotations[0]).toMatchObject({
        function: "Point#distance",
        property: "nonNegative",
        szs: "Theorem",
        axioms: [],
      });
    },
  );
});
