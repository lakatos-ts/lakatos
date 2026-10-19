import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  announcedRunDir,
  enabled,
  fakeLake,
  proveTimeoutMs,
  runMain,
  scratchDir,
  useTempProject,
} from "./helpers/cli.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";

// The emission pipeline through the binary, with a fake `lake` answering
// each artifact's `env lean`: the containment, health, and model contracts,
// exit codes included. The build and the renderer stay real.

const verdictLine = (
  file: string,
  fn: string,
  property: string,
  szs: string,
  extra = "",
) =>
  `echo 'thales-verdict:{"identity":["${file}","${fn}","${property}"],"szs":"${szs}","reason":"r"${extra}}'`;

const modelLine = (fields: string) => `echo 'thales-model:{${fields}}'`;

/** Emit the lines for whichever artifact runs, keyed by its basename. */
const byArtifact = (cases: Record<string, string>) =>
  `case "$(basename "$ARTIFACT")" in\n${Object.entries(cases)
    .map(([k, v]) => `  ${k}) ${v} ;;`)
    .join("\n")}\n  *) exit 0 ;;\nesac`;

/** A fake whose every `env lean` leaves a line in a log before `body`
 * runs, to show which artifacts the engine ran. */
function loggingLake(body = ""): {
  env: NodeJS.ProcessEnv;
  ran: () => string;
} {
  const log = path.join(scratchDir("thales-ran-"), "ran");
  return {
    env: fakeLake(`basename "$ARTIFACT" >> '${log}'\n${body}`),
    ran: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
  };
}

/** What a declaration the artifact stated no obligation for carries: the
 * fakes below mostly ship no model lines, so this is those entries' field. */
const unstated = (fn: string) => ({
  status: "unvalidated" as const,
  reason: `no correspondence obligation was stated for '${fn}'`,
});

const HUGE = {
  file: "mixed.ts",
  function: "huge",
  property: "big",
  szs: "NotTried",
  kind: "unsupported-range",
  reason:
    "endpoint 1000000000000000000000000000000 exceeds the safe integer range (±9007199254740991)",
};

const T = proveTimeoutMs(2);

describe.runIf(enabled)("thales prove, plain pipeline", () => {
  useTempProject("lakatos-cli-prove-plain-", {
    "annotated.ts": `/** @ensures{pos} forall (n: int ∈ [0, 5)) { annotated(n) >= 0 } */\nexport function annotated(n: number): number { return n; }\n`,
    "other.ts": `/** @ensures{pos} forall (n: int ∈ [0, 5)) { other(n) >= 0 } */\nexport function other(n: number): number { return n; }\n`,
    "mixed.ts": [
      "/** @ensures{big} forall (n: int ∈ [0, 1000000000000000000000000000000]) { huge(n) >= 0 } */",
      "export function huge(n: number): number { return n; }",
      "",
      "/** @ensures{pos} forall (n: int ∈ [0, 5)) { small(n) >= 0 } */",
      "export function small(n: number): number { return n; }",
      "",
    ].join("\n"),
    "consts.ts": [
      "const double = (x: number): number => x * 2;",
      "/** @ensures{pos} forall (n: int ∈ [0, 4)) { applyDouble(n) >= 0 } */",
      "export function applyDouble(n: number): number {",
      "  return double(n);",
      "}",
      "",
    ].join("\n"),
    "classbinder.ts": [
      "export class Box { constructor(readonly size: number) {} }",
      "/** @ensures{p} forall (b: Box) { volume(b) >= 0 } */",
      "export function volume(b: Box): number { return b.size; }",
      "",
    ].join("\n"),
    "plain.ts": "export const x = 1;\n",
    "dollar.ts": `/** @ensures{pos} forall (n: int ∈ [0, 5)) { f$(n) >= 0 } */\nexport function f$(n: number): number { return n; }\n`,
    "invalid.ts": `class Hidden {\n  /** @ensures{p} forall (x: int) { id(x) === x } */\n  static id(x: number): number { return x; }\n}\n`,
  });

  it(
    "healthy run: classified and proved annotations merge, exit 0",
    async () => {
      const env = fakeLake(
        byArtifact({
          "mixed.ts.lean": verdictLine("mixed.ts", "small", "pos", "Theorem"),
        }),
      );
      const { code, stdout, stderr } = await runMain(["mixed.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          HUGE,
          {
            file: "mixed.ts",
            function: "small",
            property: "pos",
            szs: "Theorem",
            axioms: [],
            model: unstated("small"),
          },
        ]),
      );
      expect(envelope.annotations).toHaveLength(2);
      // The run's artifact is the file's lemma document, whose emission
      // only mappable declarations reach.
      const document = JSON.parse(
        fs.readFileSync(
          path.join(announcedRunDir(stderr), "thales", "mixed.ts.json"),
          "utf8",
        ),
      );
      expect(document).toMatchObject({ schemaVersion: 1, outcome: "program" });
      const { emission } = document;
      expect(
        emission.declarations.map((d: { name: string }) => d.name),
      ).toEqual(["huge", "small"]);
      expect(emission.obligations).toHaveLength(1);
    },
    T,
  );

  it(
    "a classified binder never reaches the engine; a residual site does",
    async () => {
      // The call to a declaration outside the model is a residual site, so
      // `consts.ts` is emitted and the prover answers for it. A binder over a
      // degraded class still classifies: there is nothing to quantify over.
      const reason =
        "the property reaches code outside the model: 'double' could not " +
        "be modeled: unmapped TypeScript construct 'VariableStatement' at 1:7";
      const answer = `echo 'thales-verdict:{"identity":["consts.ts","applyDouble","pos"],"szs":"Inappropriate","reason":"${reason.replaceAll("'", "'\\''")}"}'`;
      const { env, ran } = loggingLake(
        byArtifact({ "consts.ts.lean": answer }),
      );
      const { code, stdout } = await runMain(
        ["consts.ts", "classbinder.ts"],
        env,
      );
      expect(ran()).toBe("consts.ts.lean\n");
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          {
            file: "consts.ts",
            function: "applyDouble",
            property: "pos",
            szs: "Inappropriate",
            reason,
            model: unstated("applyDouble"),
          },
          {
            file: "classbinder.ts",
            function: "volume",
            property: "p",
            szs: "Inappropriate",
            reason:
              "'volume' could not be modeled: 'Box' could not be modeled: " +
              "unmapped TypeScript construct 'ReadonlyKeyword' at 1:32",
          },
        ]),
      );
      expect(envelope.annotations).toHaveLength(2);
    },
    T,
  );

  it(
    "a contained file failure: Error entries for that file, siblings verdict, exit 2",
    async () => {
      const env = fakeLake(
        byArtifact({
          "annotated.ts.lean": verdictLine(
            "annotated.ts",
            "annotated",
            "pos",
            "Theorem",
          ),
          "other.ts.lean": "echo broken >&2; exit 1",
        }),
      );
      const { code, stdout, stderr } = await runMain(
        ["annotated.ts", "other.ts"],
        env,
      );
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          {
            file: "annotated.ts",
            function: "annotated",
            property: "pos",
            szs: "Theorem",
            axioms: [],
            model: unstated("annotated"),
          },
          {
            file: "other.ts",
            function: "other",
            property: "pos",
            szs: "Error",
            error:
              "the Lean run on this file's artifact failed before reporting its verdicts",
          },
        ]),
      );
      expect(envelope.annotations).toHaveLength(2);
      expect(stderr).toContain("error: broken");
    },
    T,
  );

  it(
    "an artifact that fails to render is contained to its file, exit 2",
    async () => {
      // `f$` is a TypeScript identifier the renderer cannot spell in Lean.
      const env = fakeLake(
        byArtifact({
          "annotated.ts.lean": verdictLine(
            "annotated.ts",
            "annotated",
            "pos",
            "Theorem",
          ),
        }),
      );
      const { code, stdout, stderr } = await runMain(
        ["annotated.ts", "dollar.ts"],
        env,
      );
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          {
            file: "annotated.ts",
            function: "annotated",
            property: "pos",
            szs: "Theorem",
            axioms: [],
            model: unstated("annotated"),
          },
          {
            file: "dollar.ts",
            function: "f$",
            property: "pos",
            szs: "Error",
            error:
              "the Lean run on this file's artifact failed before reporting its verdicts",
          },
        ]),
      );
      expect(envelope.annotations).toHaveLength(2);
      const runDir = announcedRunDir(stderr);
      expect(stderr).toContain(
        `error: rendering ${path.join(runDir, "thales", "dollar.ts.json")} failed before writing the artifact`,
      );
      expect(stderr).toContain(
        "error: 'f$' is not an emittable identifier yet",
      );
      expect(fs.existsSync(path.join(runDir, "thales", "dollar.ts.lean"))).toBe(
        false,
      );
    },
    T,
  );

  it(
    "an unhealthy join: all NotTried, exit 2",
    async () => {
      const env = fakeLake(
        byArtifact({
          "annotated.ts.lean":
            verdictLine("annotated.ts", "annotated", "pos", "Theorem") +
            "; " +
            verdictLine("annotated.ts", "phantom", "pos", "Theorem"),
        }),
      );
      const { code, stdout } = await runMain(["annotated.ts"], env);
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual([
        {
          file: "annotated.ts",
          function: "annotated",
          property: "pos",
          szs: "NotTried",
        },
      ]);
    },
    T,
  );

  it(
    "an interrupted run reports User for everything planned, exit 2",
    async () => {
      const env = fakeLake("kill -INT $$");
      const { code, stdout } = await runMain(["annotated.ts", "mixed.ts"], env);
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          {
            file: "annotated.ts",
            function: "annotated",
            property: "pos",
            szs: "User",
            reason: "the run was interrupted (SIGINT)",
          },
          {
            file: "mixed.ts",
            function: "small",
            property: "pos",
            szs: "User",
            reason: "the run was interrupted (SIGINT)",
          },
          // Settled before the engine ran; the interrupt does not unsettle it.
          HUGE,
        ]),
      );
      expect(envelope.annotations).toHaveLength(3);
    },
    T,
  );

  it(
    "no Lean engine: NotTried envelope, exit 2",
    async () => {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "thales-no-lake-"));
      fs.symlinkSync(process.execPath, path.join(bin, "node"));
      try {
        const { code, stdout, stderr } = await runMain(["annotated.ts"], {
          ...process.env,
          PATH: bin,
        });
        expect(code).toBe(2);
        const envelope = JSON.parse(stdout[0]!);
        expectValidEnvelope(envelope);
        expect(envelope.annotations).toEqual([
          {
            file: "annotated.ts",
            function: "annotated",
            property: "pos",
            szs: "NotTried",
          },
        ]);
        expect(stderr).toContain(
          "error: lake was not found on PATH; install the Lean toolchain via elan (https://leanprover-community.github.io/get_started/) and re-run",
        );
      } finally {
        fs.rmSync(bin, { recursive: true, force: true });
      }
    },
    T,
  );

  it(
    "verdict fields map through: an Inappropriate reason survives",
    async () => {
      const env = fakeLake(
        `echo 'thales-verdict:{"identity":["annotated.ts","annotated","pos"],"szs":"Inappropriate","reason":"outside the model"}'`,
      );
      const { code, stdout } = await runMain(["annotated.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations[0]).toMatchObject({
        szs: "Inappropriate",
        reason: "outside the model",
      });
    },
    T,
  );

  it(
    "a refuted property ships falsified and exits 1, like refute",
    async () => {
      const env = fakeLake(
        verdictLine(
          "annotated.ts",
          "annotated",
          "pos",
          "CounterSatisfiable",
          ',"counterexample":{"n":2}',
        ),
      );
      const { code, stdout } = await runMain(["annotated.ts"], env);
      expect(code).toBe(1);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations[0]).toMatchObject({
        szs: "CounterSatisfiable",
        kind: "falsified",
        counterexample: { n: 2 },
      });
    },
    T,
  );

  it(
    "an unhealthy run keeps the unsupported-range metadata",
    async () => {
      const env = fakeLake("exit 0");
      const { code, stdout } = await runMain(["mixed.ts"], env);
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual(
        expect.arrayContaining([
          HUGE,
          {
            file: "mixed.ts",
            function: "small",
            property: "pos",
            szs: "NotTried",
          },
        ]),
      );
      expect(envelope.annotations).toHaveLength(2);
    },
    T,
  );

  it(
    "input errors join the envelope and force exit 2",
    async () => {
      const env = fakeLake(
        verdictLine("annotated.ts", "annotated", "pos", "Theorem"),
      );
      const { code, stdout, stderr } = await runMain(
        ["annotated.ts", "invalid.ts"],
        env,
      );
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual([
        {
          file: "annotated.ts",
          function: "annotated",
          property: "pos",
          szs: "Theorem",
          axioms: [],
          model: unstated("annotated"),
        },
        {
          file: "invalid.ts",
          function: "Hidden.id",
          property: "p",
          szs: "InputError",
          error: expect.stringMatching(/^invalid\.ts:2: /),
        },
      ]);
      expect(stderr.join("\n")).toContain("invalid.ts:2: ");
    },
    T,
  );

  it(
    "only input errors: nothing to emit, the prover never runs, exit 2",
    async () => {
      const { env, ran } = loggingLake();
      const { code, stdout } = await runMain(["invalid.ts"], env);
      expect(code).toBe(2);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toHaveLength(1);
      expect(envelope.annotations[0]).toMatchObject({ szs: "InputError" });
      expect(ran()).toBe("");
    },
    T,
  );

  it(
    "no annotations at all: empty envelope, no prover run, exit 0",
    async () => {
      const { env, ran } = loggingLake();
      const { code, stdout, stderr } = await runMain(["plain.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations).toEqual([]);
      expect(stderr.join("\n")).toContain(
        "emitted 0 annotations across 1 file(s)",
      );
      expect(ran()).toBe("");
    },
    T,
  );

  it(
    "join mismatches surface as unhealthy exit 2",
    async () => {
      // A healthy Lean run whose verdicts do not cover the annotations is
      // untrustworthy: it indicates an emitter or engine bug.
      const env = fakeLake("exit 0");
      const missing = await runMain(["annotated.ts"], env);
      expect(missing.code).toBe(2);
      expect(missing.stderr.join("\n")).toContain("no verdict for");
      const envelope = JSON.parse(missing.stdout[0]!);
      expectValidEnvelope(envelope);
      expect(envelope.annotations[0].szs).toBe("NotTried");
    },
    T,
  );

  it(
    "a validated model lands on the Theorem and prints nothing",
    async () => {
      const env = fakeLake(
        modelLine('"file":"mixed.ts","function":"small","status":"validated"') +
          "\n" +
          verdictLine("mixed.ts", "small", "pos", "Theorem"),
      );
      const { code, stdout, stderr } = await runMain(["mixed.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(
        envelope.annotations.find(
          (a: { function: string }) => a.function === "small",
        ),
      ).toEqual({
        file: "mixed.ts",
        function: "small",
        property: "pos",
        szs: "Theorem",
        axioms: [],
        model: { status: "validated" },
      });
      expect(stderr.join("\n")).not.toContain("model unvalidated");
    },
    T,
  );

  it(
    "an unvalidated model is one stderr note beside the verdict",
    async () => {
      const env = fakeLake(
        modelLine(
          '"file":"mixed.ts","function":"small","status":"unvalidated","reason":"stuck"',
        ) +
          "\n" +
          verdictLine("mixed.ts", "small", "pos", "Theorem"),
      );
      const { code, stdout, stderr } = await runMain(["mixed.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(
        envelope.annotations.find(
          (a: { function: string }) => a.function === "small",
        ).model,
      ).toEqual({ status: "unvalidated", reason: "stuck" });
      expect(stderr.filter((l) => l.includes("model unvalidated"))).toEqual([
        "thales: mixed.ts small/pos: PROVED (model unvalidated: stuck)",
      ]);
    },
    T,
  );

  it(
    "a duplicate model line is unhealthy, exit 2",
    async () => {
      const line = modelLine(
        '"file":"mixed.ts","function":"small","status":"validated"',
      );
      const env = fakeLake(
        `${line}\n${line}\n${verdictLine("mixed.ts", "small", "pos", "Theorem")}`,
      );
      const { code, stdout, stderr } = await runMain(["mixed.ts"], env);
      expect(code).toBe(2);
      expect(stderr).toContain(
        'error: duplicate model line for ["mixed.ts","small"]',
      );
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      expect(
        envelope.annotations.find(
          (a: { function: string }) => a.function === "small",
        ).szs,
      ).toBe("NotTried");
    },
    T,
  );

  it(
    "a model line for an unannotated declaration is ignored",
    async () => {
      const env = fakeLake(
        modelLine('"file":"mixed.ts","function":"ghost","status":"validated"') +
          "\n" +
          modelLine(
            '"file":"mixed.ts","function":"small","status":"validated"',
          ) +
          "\n" +
          verdictLine("mixed.ts", "small", "pos", "Theorem"),
      );
      const { code, stdout } = await runMain(["mixed.ts"], env);
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout[0]!);
      expectValidEnvelope(envelope);
      const withModel = envelope.annotations.filter(
        (a: { model?: unknown }) => a.model !== undefined,
      );
      expect(withModel.map((a: { function: string }) => a.function)).toEqual([
        "small",
      ]);
    },
    T,
  );

  it(
    "Lean diagnostics pass through to stderr on a healthy run",
    async () => {
      const env = fakeLake(
        `echo "unsolved goal"\n${verdictLine("annotated.ts", "annotated", "pos", "Theorem")}`,
      );
      const { code, stderr } = await runMain(["annotated.ts"], env);
      expect(code).toBe(0);
      expect(stderr).toContain("unsolved goal");
    },
    T,
  );

  it(
    "a file above the current directory is refused with the mirror message, exit 2",
    async () => {
      // Annotated, so the refusal is an InputError entry and not just a note.
      const above = path.join(path.dirname(process.cwd()), "above.ts");
      fs.writeFileSync(
        above,
        "/** @ensures{pos} forall (n: int ∈ [0, 5)) { above(n) >= 0 } */\n" +
          "export function above(n: number): number { return n; }\n",
      );
      try {
        const { code, stdout, stderr } = await runMain(["../above.ts"]);
        expect(code).toBe(2);
        const message =
          "../above.ts is not part of the program tsconfig.json describes, so it was not type checked";
        expect(stderr).toContain(`error: ${message}`);
        const envelope = JSON.parse(stdout[0]!);
        expectValidEnvelope(envelope);
        expect(envelope.annotations).toEqual([
          {
            file: "../above.ts",
            function: "above",
            property: "pos",
            szs: "InputError",
            error: message,
          },
        ]);
        // Nothing was written for it, inside the run root or above it.
        const out = path.join(announcedRunDir(stderr), "thales");
        expect(fs.existsSync(out) ? fs.readdirSync(out) : []).toEqual([]);
        expect(fs.existsSync(`${above}.json`)).toBe(false);
      } finally {
        fs.rmSync(above, { force: true });
      }
    },
    T,
  );
});
