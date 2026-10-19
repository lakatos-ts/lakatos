import { beforeAll, afterAll, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expectValidEnvelope } from "./envelope-schema.js";

/** What thales's suites read of an envelope; the schema check is the full contract. */
export interface Annotation {
  file: string;
  function: string;
  property: string;
  szs: string;
  [field: string]: unknown;
}
export interface Envelope {
  annotations: Annotation[];
  [field: string]: unknown;
}

export interface MainRun {
  code: number;
  stdout: string[];
  stderr: string[];
}

/** The bin suites spawn the Lean binary, so they need the toolchain. */
export const enabled = process.env.LAKATOS_PROVE_E2E === "1";
export const BUILD_TIMEOUT_MS = 600_000;
export const LEAN_TIMEOUT_MS = 300_000;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const engineRoot = path.join(repoRoot, "thales");
const lemmaRoot = path.join(repoRoot, "lemma");
let built: string | undefined;

/** Spawned output is buffered whole; a chatty Lean run outgrows Node's 1 MB default. */
export const MAX_BUFFER = 256 * 1024 * 1024;

const scratchDirs: string[] = [];

/** A fresh temp directory, removed when the file's suites finish. */
export function scratchDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The binary, built once per process; the e2e gate implies the toolchain. */
export function thalesBinary(): string {
  if (built !== undefined) return built;
  execFileSync("lake", ["build", "thales"], {
    cwd: engineRoot,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: BUILD_TIMEOUT_MS,
  });
  const bin = path.join(engineRoot, ".lake", "build", "bin", "thales");
  if (!fs.existsSync(bin))
    throw new Error(
      `build it: lake build thales from thales/ (expected ${bin})`,
    );
  built = bin;
  return bin;
}

/**
 * Run the binary from the current directory with both streams captured:
 * stdout as one entry (the envelope), stderr as lines.
 */
export async function runMain(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<MainRun> {
  const r = spawnSync(thalesBinary(), argv, {
    encoding: "utf8",
    env: { LAKATOS_LEMMA: lemmaRoot, ...env },
    timeout: BUILD_TIMEOUT_MS + 2 * LEAN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (r.error) throw r.error;
  const stdout = r.stdout.trim() === "" ? [] : [r.stdout.trimEnd()];
  const stderr = r.stderr === "" ? [] : r.stderr.trimEnd().split("\n");
  return { code: r.status ?? -1, stdout, stderr };
}

/**
 * A `lake` ahead of the real one on PATH: `env lean …` runs `body` as sh
 * with the artifact path in `$ARTIFACT`; everything else goes to the real
 * lake, so the build and the renderer's search path stay real.
 */
export function fakeLake(body: string): NodeJS.ProcessEnv {
  const real = execFileSync("sh", ["-c", "command -v lake"], {
    encoding: "utf8",
  }).trim();
  const dir = scratchDir("fake-lake-");
  const script = `#!/bin/sh
if [ "$1" = "env" ] && [ "$2" = "lean" ]; then
  for a in "$@"; do ARTIFACT="$a"; done
  export ARTIFACT
${body}
  exit $?
fi
exec '${real.replace(/'/g, "'\\''")}' "$@"
`;
  fs.writeFileSync(path.join(dir, "lake"), script, { mode: 0o755 });
  return {
    ...process.env,
    LAKATOS_LEMMA: lemmaRoot,
    PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

/** The tsconfig a scratch project gets when a suite supplies none: enough
 * for tsc to describe the program (lakatos forces strict itself). Excludes
 * the run root so generated artifacts never join the program. */
export const DEFAULT_TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

function ensureTsconfig(dir: string): void {
  const dest = path.join(dir, "tsconfig.json");
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, DEFAULT_TSCONFIG, "utf8");
}

/**
 * The run directory the CLI announced on stderr. Tests read it the way a
 * user does rather than recomputing it from the envelope's startedAt: a run
 * whose name was taken steps to the next free one, so the two can differ.
 */
export function announcedRunDir(stderr: string[]): string {
  const m = /into (.+)[/\\]thales\/$/m.exec(stderr.join("\n"));
  if (m === null)
    throw new Error(`no run directory announced in: ${stderr.join("\n")}`);
  return m[1]!;
}

/**
 * Run the binary and unwrap the single-envelope contract: the expected exit
 * code (0 unless the run is meant to find counterexamples), exactly one
 * stdout line, and that line a schema-valid envelope.
 */
export async function runForEnvelope(
  argv: string[],
  expectedCode = 0,
  env?: NodeJS.ProcessEnv,
): Promise<Envelope> {
  const run = await runMain(argv, env);
  expect(run.code, run.stderr.join("\n")).toBe(expectedCode);
  expect(run.stdout).toHaveLength(1);
  const envelope = JSON.parse(run.stdout[0]!) as Envelope;
  expectValidEnvelope(envelope);
  return envelope;
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
 * Like useTempProject, but at a directory the caller names, inside the
 * repo tree. `populate` writes the project's files before the chdir.
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
