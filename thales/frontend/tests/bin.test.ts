import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { main } from "../src/cli.js";

vi.mock("node:util", async (importActual) => {
  const actual = await importActual<typeof import("node:util")>();
  return { ...actual, parseArgs: vi.fn(actual.parseArgs) };
});

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

describe("the thales bin", () => {
  it("prints help naming itself and exits 0", async () => {
    const r = await capture(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toMatch(/^usage: thales \[files-or-globs\.\.\.\]/);
  });

  it("exits 2 with usage on an unknown option, --seed included", async () => {
    const r = await capture(["--seed", "3"]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual(["usage: thales [files-or-globs...]"]);
  });

  it("exits 2 with an error line when no file matches", async () => {
    const r = await capture(["no-such-file-anywhere.ts"]);
    expect(r.code).toBe(2);
    expect(r.err.at(-1)).toMatch(/^error: /);
  });

  it("lets an error that is not a usage error escape", async () => {
    vi.mocked(parseArgs).mockImplementationOnce(() => {
      throw new RangeError("not a parse error");
    });
    await expect(capture([])).rejects.toThrow(RangeError);
  });
});

describe("with no tsconfig.json and no arguments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-no-tsconfig-"));
  const prev = process.cwd();
  beforeAll(() => {
    fs.writeFileSync(path.join(dir, "a.ts"), "export const one = 1;\n");
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prev);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("exits 2 with a hint that names no tool", async () => {
    const r = await capture([]);
    expect(r.code).toBe(2);
    expect(r.err).toEqual([
      'error: no tsconfig.json to discover sources from; pass files or globs (e.g. "src/**/*.ts")',
    ]);
  });
});
