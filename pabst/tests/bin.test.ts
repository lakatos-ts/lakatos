import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { main } from "../src/cli.js";
import { refute } from "../src/index.js";

async function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((s) => {
    out.push(String(s));
  });
  const error = vi.spyOn(console, "error").mockImplementation((s) => {
    err.push(String(s));
  });
  try {
    return { code: await main(argv), out, err };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

describe("the pabst bin", () => {
  it("prints help naming itself and exits 0", async () => {
    const r = await capture(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toMatch(/^usage: pabst \[--seed <n>\]/);
  });

  it("exits 2 with usage on an unknown option", async () => {
    const r = await capture(["--nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual(["usage: pabst [--seed <n>] [files-or-globs...]"]);
  });

  it("exits 2 on a bad seed before resolving any file", async () => {
    const r = await capture(["--seed", "4.2", "missing.ts"]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      "error: invalid --seed '4.2': must be a non-negative integer",
    ]);
  });
});

describe("the refute API", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pabst-api-"));
  const prev = process.cwd();
  beforeAll(() => {
    fs.writeFileSync(
      path.join(dir, "plain.ts"),
      "export const one = 1;\n",
      "utf8",
    );
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

  it("hands the envelope back through its io and touches no console", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    const lines: string[] = [];
    let emitted = 0;
    try {
      const report = await refute(["plain.ts"], {
        seed: 7,
        io: { note: (l) => lines.push(l), emit: () => emitted++ },
      });
      expect(report.code).toBe(0);
      expect(report.envelope).toMatchObject({
        seed: 7,
        generated: 0,
        passed: 0,
        failed: 0,
        annotations: [],
      });
      expect(emitted).toBe(1);
      expect(lines).toEqual([
        expect.stringMatching(
          /^pabst: generated 0 properties across 0 file\(s\) into .+\/pabst\/$/,
        ),
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
