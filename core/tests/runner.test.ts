import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Envelope } from "../src/envelope.js";
import { RUN_ROOT } from "../src/run-dir.js";
import {
  packageVersion,
  runTool,
  type Admission,
  type Outcome,
  type Plan,
  type Spine,
  type ToolIo,
} from "../src/runner.js";

const TOOL = { name: "tool", version: "9.9.9" };
const ID = { file: "a.ts", function: "f", property: "p" };

function capture(): ToolIo & { lines: string[]; emitted: Envelope[] } {
  const lines: string[] = [];
  const emitted: Envelope[] = [];
  return {
    lines,
    emitted,
    note: (line) => lines.push(line),
    emit: (envelope) => emitted.push(envelope),
  };
}

const admitted = (over: Partial<Admission> = {}): Admission =>
  ({
    kind: "admitted",
    files: ["a.ts"],
    refused: new Set<string>(),
    refusals: [],
    notes: [],
    ...over,
  }) as Admission;

function plan(over: Partial<Plan> = {}): Plan {
  return {
    identities: [ID],
    untried: [],
    inputErrors: [],
    notes: [],
    degraded: false,
    outFiles: ["a.test.ts"],
    meta: {},
    emptyMeta: {},
    emptyExit: 0,
    ...over,
  };
}

const spine = (p: Plan, outcome?: Outcome): Spine => ({
  plan: () => p,
  ...(outcome !== undefined ? { run: () => outcome } : {}),
});

describe("runTool", () => {
  let prev: string;
  let dir: string;
  beforeEach(() => {
    prev = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-runner-"));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stops a refused admission at exit 2 without claiming a run directory", async () => {
    const io = capture();
    const report = await runTool(
      TOOL,
      () => ({
        kind: "refused",
        refusals: [{ ...ID, error: "no tsconfig" }],
        notes: [{ level: "info", text: "refused 1" }],
      }),
      spine(plan()),
      io,
    );
    expect(report.code).toBe(2);
    expect(report.envelope.annotations).toEqual([
      { ...ID, szs: "InputError", error: "no tsconfig" },
    ]);
    expect(report.envelope.version).toBe("9.9.9");
    expect(io.lines).toEqual(["tool: refused 1"]);
    expect(io.emitted).toEqual([report.envelope]);
    expect(fs.existsSync(RUN_ROOT)).toBe(false);
  });

  it("echoes the plan's refusals before the plan's own notes", async () => {
    const io = capture();
    await runTool(
      TOOL,
      () => admitted({ notes: [{ level: "error", text: "admission fault" }] }),
      spine(
        plan({
          outFiles: [],
          inputErrors: [{ ...ID, property: "q", error: "a.ts:3: bad" }],
          notes: [{ level: "info", text: "generated 1 property" }],
        }),
      ),
      io,
    );
    expect(io.lines).toEqual([
      "error: admission fault",
      "error: a.ts:3: bad",
      "tool: generated 1 property",
    ]);
  });

  it("reports an empty plan with its empty meta and exit", async () => {
    const report = await runTool(
      TOOL,
      () => admitted(),
      spine(
        plan({
          outFiles: [],
          emptyMeta: { passed: 0, failed: 0 },
          emptyExit: 1,
        }),
      ),
      capture(),
    );
    expect(report.code).toBe(1);
    expect(report.envelope).toMatchObject({ passed: 0, failed: 0 });
  });

  it("counts unsupported ranges under the tool's name", async () => {
    const io = capture();
    await runTool(
      TOOL,
      () => admitted(),
      spine(
        plan({
          outFiles: [],
          untried: [
            { ...ID, szs: "NotTried", kind: "unsupported-range", reason: "r" },
          ],
        }),
      ),
      io,
    );
    expect(io.lines).toEqual([
      "tool: 1 annotation not tried (unsupported range)",
    ]);
  });

  it("exits 1 on a refutation and 2 when an input error sits beside it", async () => {
    const completed: Outcome = {
      kind: "completed",
      annotations: [{ ...ID, szs: "CounterSatisfiable" }],
      meta: { passed: 0, failed: 1 },
      degraded: false,
      refuted: true,
    };
    const clean = await runTool(
      TOOL,
      () => admitted(),
      spine(plan(), completed),
      capture(),
    );
    expect(clean.code).toBe(1);
    expect(clean.envelope).toMatchObject({ passed: 0, failed: 1 });
    const withError = await runTool(
      TOOL,
      () => admitted({ refusals: [{ ...ID, property: "q", error: "e" }] }),
      spine(plan(), completed),
      capture(),
    );
    expect(withError.code).toBe(2);
    expect(withError.envelope.annotations).toContainEqual({
      ...ID,
      property: "q",
      szs: "InputError",
      error: "e",
    });
  });

  it("reports an unhealthy run as NotTried with its messages as errors", async () => {
    const io = capture();
    const report = await runTool(
      TOOL,
      () => admitted(),
      spine(plan(), { kind: "unhealthy", messages: ["vitest died"] }),
      io,
    );
    expect(report.code).toBe(2);
    expect(report.envelope.annotations).toEqual([{ ...ID, szs: "NotTried" }]);
    expect(io.lines).toContain("error: vitest died");
  });

  it("reports an interrupted run as User under the tool's name", async () => {
    const io = capture();
    const report = await runTool(
      TOOL,
      () => admitted(),
      spine(plan(), { kind: "interrupted", signal: "SIGTERM" }),
      io,
    );
    expect(report.code).toBe(2);
    expect(report.envelope.annotations[0]).toMatchObject({ szs: "User" });
    expect(io.lines).toContain(
      "tool: interrupted by SIGTERM; reporting 1 annotation as User",
    );
  });

  it("names a proof that rests on an unvalidated model", async () => {
    const io = capture();
    await runTool(
      TOOL,
      () => admitted(),
      spine(plan(), {
        kind: "completed",
        annotations: [
          {
            ...ID,
            szs: "Theorem",
            model: { status: "unvalidated", reason: "why" },
          },
        ],
        meta: {},
        degraded: false,
        refuted: false,
      }),
      io,
    );
    expect(io.lines).toContain(
      "tool: a.ts f/p: PROVED (model unvalidated: why)",
    );
  });

  it("emits the envelope while the interrupt guard still stands", async () => {
    let listening = 0;
    await runTool(
      TOOL,
      () => admitted(),
      spine(plan(), {
        kind: "completed",
        annotations: [{ ...ID, szs: "GaveUp" }],
        meta: {},
        degraded: false,
        refuted: false,
      }),
      {
        note: () => {},
        emit: () => {
          listening = process.listenerCount("SIGINT");
        },
      },
    );
    expect(listening).toBeGreaterThan(0);
  });
});

describe("packageVersion", () => {
  it("reads the nearest package.json above the module", () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(packageVersion(import.meta.url)).toBe(pkg.version);
  });
});
