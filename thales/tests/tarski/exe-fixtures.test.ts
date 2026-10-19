import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseScript, stripTypes } from "@lakatos/lemma";
import { ensureBinary } from "./helpers/binary.js";

// Every `@ensures` fixture in this package, run on the tarski evaluator and
// under Node, with the two compared. This is what says the evaluator is an
// evaluator rather than a plausible-looking one: the same programs
// `thales` proves theorems about, executed, with an engine as the
// control.
//
// It needs the real binary, so it runs where `test262-e2e.test.ts` runs —
// `lean.yml`, the one job with Node and Lean — and skips elsewhere.
//
// Each fixture is stripped and parsed through lemma's barrel and run with
// `tarski exec`, not with `tarski <file.ts>`: what is measured is the
// evaluator, and no tsconfig's program holds all of these fixtures at
// once, so the gate would refuse them before the evaluator saw one.
// `exe-e2e.test.ts` is where the gated command is run.
const e2e = process.env.LAKATOS_TARSKI_E2E === "1";

const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));

/** The two fixture roots. */
const ROOTS = ["tests/fixtures", "tests/conformance"];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    )
      out.push(full);
  }
  return out;
}

/** The corpus, as package-relative posix paths, sorted. */
function corpus(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(path.join(PACKAGE, root), files);
  return files
    .filter((f) => readFileSync(f, "utf8").includes("@ensures"))
    .map((f) => path.relative(PACKAGE, f).split(path.sep).join("/"))
    .sort();
}

/**
 * The fixtures the evaluator refuses, each with the node kind it named.
 * Measured, not predicted: a row that moves is either a slice that landed
 * or a regression, and either way it belongs in a diff.
 *
 * Nine of the corpus's hundred and ninety-one. The six `ImportDeclaration`
 * rows are the multi-file fixtures, which the evaluator refuses by design —
 * it resolves no module graph. The rest is syntax outside the evaluated
 * fragment: an `async` function and `&`.
 */
const UNSUPPORTED: Record<string, string> = {
  "tests/conformance/inappropriate/await-remote.ts":
    "FunctionDeclaration async",
  "tests/conformance/inappropriate/bare-import/main.ts": "ImportDeclaration",
  "tests/conformance/inappropriate/import-cycle/main.ts": "ImportDeclaration",
  "tests/conformance/inappropriate/unmodeled-operator.ts": "BinaryExpression &",
  "tests/conformance/theorem/aliased-export/main.ts": "ImportDeclaration",
  "tests/conformance/theorem/barrel-import/main.ts": "ImportDeclaration",
  "tests/conformance/theorem/imported-constants/main.ts": "ImportDeclaration",
  "tests/conformance/theorem/imported-scale/main.ts": "ImportDeclaration",
  "tests/fixtures/tracer.ts": "FunctionDeclaration async",
};

/**
 * A fixture the evaluator supports but whose run differs from Node's, for
 * a reason outside this slice. Empty, and meant to stay that way: a row
 * here needs the issue it waits on written beside it.
 */
const DISAGREES: Record<string, string> = {};

/** One `tarski exec`, under a timeout: a fixture that diverges must not
 * take the suite with it. `tarski` itself imposes none — a program hangs as
 * it would under `node` — but a batch of 191 is a different contract. */
const EXEC_TIMEOUT_MS = 30_000;

/** The whole corpus, run once: two spawns a fixture is enough. */
const MEASURE_TIMEOUT_MS = 600_000;

describe("the fixture roots", () => {
  it("all exist, so the walk never runs over a stale path", () => {
    for (const root of ROOTS)
      expect(existsSync(path.join(PACKAGE, root)), root).toBe(true);
  });
});

describe.runIf(e2e)(
  "every @ensures fixture, on the evaluator and on Node",
  () => {
    const files = corpus();
    const scratch = path.join(PACKAGE, ".lakatos", "exe-fixtures");
    /** The node kind each refused fixture named. */
    const refused: Record<string, string> = {};
    /** What each supported fixture did differently from Node. */
    const disagreed: Record<string, string> = {};

    // One pass, in a hook, so the two claims below are two readings of one
    // measurement rather than two runs of the same 191 programs.
    beforeAll(() => {
      rmSync(scratch, { recursive: true, force: true });
      mkdirSync(scratch, { recursive: true });
      const binary = ensureBinary();
      expect(binary.kind, JSON.stringify(binary)).toBe("ready");
      if (binary.kind !== "ready") return;

      for (const file of files) {
        const outDir = path.join(scratch, file);
        mkdirSync(outDir, { recursive: true });
        const base = path.basename(file).replace(/\.ts$/, "");
        const script = stripTypes(
          readFileSync(path.join(PACKAGE, file), "utf8"),
          file,
        );
        const documentPath = path.join(outDir, `${base}.json`);
        writeFileSync(path.join(outDir, `${base}.js`), script);
        writeFileSync(documentPath, JSON.stringify(parseScript(script, file)));
        const run = spawnSync(binary.binary, ["exec", documentPath], {
          encoding: "utf8",
          timeout: EXEC_TIMEOUT_MS,
          maxBuffer: 256 * 1024 * 1024,
        });
        if (run.status === 3) {
          // `unsupported: <Kind>`, as `Decode.lean` writes it.
          refused[file] = run.stderr
            .split("\n")[0]!
            .replace(/^unsupported: /, "");
          continue;
        }
        if (run.status !== 0 && run.status !== 1) {
          disagreed[file] =
            `tarski: ${run.status} ${JSON.stringify(run.stderr)}`;
          continue;
        }
        // Node runs the very same stripped text, under the extension that
        // makes it a module — the fixtures are module code.
        const mjs = path.join(outDir, `${base}.mjs`);
        copyFileSync(path.join(outDir, `${base}.js`), mjs);
        const node = spawnSync(process.execPath, [mjs], {
          encoding: "utf8",
          timeout: EXEC_TIMEOUT_MS,
        });
        if (run.stdout !== node.stdout || run.status !== node.status) {
          disagreed[file] =
            `tarski ${run.status} ${JSON.stringify(run.stdout)} / ` +
            `node ${node.status} ${JSON.stringify(node.stdout)}`;
        }
      }
    }, MEASURE_TIMEOUT_MS);

    afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    // An emptied fixture root would otherwise make this whole suite pass
    // by having nothing to compare.
    it("has a corpus to compare", () => {
      expect(files.length).toBeGreaterThan(180);
    });

    it("refuses exactly the fixtures it is pinned to refuse", () => {
      expect(refused).toEqual(UNSUPPORTED);
    });

    // Node is the control: what it prints and how it exits is what the
    // evaluator has to match. Compared by key, since a row in DISAGREES
    // carries the issue it waits on and the measurement carries the
    // difference it saw.
    it("agrees with Node on every fixture it supports", () => {
      expect(Object.keys(disagreed).sort()).toEqual(
        Object.keys(DISAGREES).sort(),
      );
    });
  },
);
