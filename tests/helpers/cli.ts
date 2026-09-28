import { beforeAll, afterAll, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { expectValidEnvelope } from "./envelope-schema.js";
import type { Envelope } from "@lakatos/core/envelope";
import {
  BUILD_TIMEOUT_MS,
  LEAN_TIMEOUT_MS,
} from "../../thales/frontend/src/run.js";

export interface MainRun {
  code: number;
  stdout: string[];
  stderr: string[];
}

/** The tsconfig a scratch project gets when a suite supplies none: enough
 * for tsc to describe the program (lakatos forces strict itself). Excludes
 * the run root so generated artifacts never join the program. */
const DEFAULT_TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

function ensureTsconfig(dir: string): void {
  const dest = path.join(dir, "tsconfig.json");
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, DEFAULT_TSCONFIG, "utf8");
}

/** A bin's `main`, the shape the pabst and thales bins both export. */
export type BinMain = (argv: string[]) => Promise<number>;

/** Run a bin's main() with both console streams captured. */
export async function runBin(main: BinMain, argv: string[]): Promise<MainRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((s) => {
    stdout.push(String(s));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((s) => {
    stderr.push(String(s));
  });
  try {
    return { code: await main(argv), stdout, stderr };
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
}

/**
 * Run a bin's main() and unwrap the single-envelope contract: the expected
 * exit code, exactly one stdout line, and that line a schema-valid envelope.
 */
export async function runBinForEnvelope(
  main: BinMain,
  argv: string[],
  expectedCode = 0,
): Promise<Envelope> {
  const run = await runBin(main, argv);
  expect(run.code, run.stderr.join("\n")).toBe(expectedCode);
  expect(run.stdout).toHaveLength(1);
  const env = JSON.parse(run.stdout[0]!) as Envelope;
  expectValidEnvelope(env);
  return env;
}

/**
 * Test-timeout ceiling for one `prove` run over `fileCount` artifacts: the
 * pipeline's own containment budget (one build, one Lean run per file) plus
 * slack, so a contained-but-slow run gets to report which file failed
 * instead of being killed by a bare vitest timeout.
 */
export function proveTimeoutMs(fileCount: number): number {
  return BUILD_TIMEOUT_MS + fileCount * LEAN_TIMEOUT_MS + 60_000;
}

/**
 * Like useTempProject, but the directory lives inside the repo tree:
 * refute's generated tests import "@lakatos/pabst/runtime" via the workspace
 * link, so suites that run refute cannot work under os.tmpdir().
 * `populate` writes the project's files before the chdir.
 */
export function useRepoScratchDir(
  workDir: string,
  populate: (dir: string) => void,
  opts: { tsconfig?: boolean } = {},
): void {
  const prevCwd = process.cwd();
  beforeAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    populate(workDir);
    if (opts.tsconfig !== false) ensureTsconfig(workDir);
    process.chdir(workDir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(workDir, { recursive: true, force: true });
  });
}

/**
 * Create a temp directory populated with `files` and chdir into it for the
 * duration of the enclosing describe block (registers beforeAll/afterAll).
 * Returns the directory path.
 */
export function useTempProject(
  prefix: string,
  files: Record<string, string>,
  opts: { tsconfig?: boolean } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const prevCwd = process.cwd();
  beforeAll(() => {
    for (const [name, text] of Object.entries(files)) {
      const dest = path.join(dir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text, "utf8");
    }
    if (opts.tsconfig !== false) ensureTsconfig(dir);
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
