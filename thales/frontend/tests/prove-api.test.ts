import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolIo } from "@lakatos/core/runner";
import type { Envelope } from "@lakatos/core/envelope";
import { runEmission } from "../src/run.js";
import { prove } from "../src/index.js";

vi.mock("../src/run.js", async (importActual) => ({
  ...(await importActual<typeof import("../src/run.js")>()),
  runEmission: vi.fn(),
}));
const runEmissionMock = vi.mocked(runEmission);

const SOURCE =
  "/** @ensures{pos} forall (x: int ∈ [0, 3)) { f(x) >= 0 } */\n" +
  "export function f(x: number): number {\n  return x;\n}\n";

function capturingIo() {
  const notes: string[] = [];
  const raw: string[] = [];
  const envelopes: Envelope[] = [];
  const io: ToolIo = {
    note: (l) => notes.push(l),
    emit: (e) => envelopes.push(e),
    raw: (t) => raw.push(t),
  };
  return { io, notes, raw, envelopes };
}

describe("the prove API with a caller's io", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-api-"));
  const prev = process.cwd();
  beforeAll(() => {
    fs.writeFileSync(path.join(dir, "a.ts"), SOURCE, "utf8");
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "es2022", module: "nodenext", types: [] },
        include: ["**/*.ts"],
        exclude: [".lakatos"],
      }),
      "utf8",
    );
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function quietly<T>(run: () => Promise<T>): Promise<T> {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const write = vi.spyOn(process.stderr, "write");
    try {
      const result = await run();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      return result;
    } finally {
      log.mockRestore();
      error.mockRestore();
      write.mockRestore();
    }
  }

  it("passes a failed Lean run's own output through io.raw", async () => {
    runEmissionMock.mockReturnValueOnce({
      kind: "failed",
      stdout: "lake out\n",
      stderr: "lake err\n",
    });
    const c = capturingIo();
    const report = await quietly(() => prove(["a.ts"], { io: c.io }));
    expect(report.code).toBe(2);
    expect(c.raw.join("")).toBe("lake out\nlake err\n");
    expect(c.envelopes).toHaveLength(1);
  });

  it("notes Lean's diagnostics and per-artifact failures through io", async () => {
    runEmissionMock.mockImplementationOnce((jobs) => ({
      kind: "completed",
      verdicts: [],
      models: [],
      diagnostics: ["a.lean:1:0: warning: unused"],
      failures: [{ file: jobs[0]!.leanFile, messages: ["it broke"] }],
    }));
    const c = capturingIo();
    const report = await quietly(() => prove(["a.ts"], { io: c.io }));
    expect(c.notes).toContain("a.lean:1:0: warning: unused");
    expect(c.notes).toContain("error: it broke");
    expect(report.envelope.annotations[0]).toMatchObject({ szs: "Error" });
  });

  it("names itself in its notes", async () => {
    runEmissionMock.mockReturnValueOnce({
      kind: "failed",
      stdout: "",
      stderr: "",
    });
    const c = capturingIo();
    await quietly(() => prove(["a.ts"], { io: c.io }));
    expect(
      c.notes.some((l) => l.startsWith("thales: emitted 1 annotation")),
    ).toBe(true);
  });
});
