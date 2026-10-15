import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_TIMEOUT_MS, LEAN_TIMEOUT_MS } from "../frontend/src/run.js";
import { expectValidEnvelope } from "./helpers/envelope-schema.js";

// The Lean `thales` (#619) against the TypeScript one it is replacing:
// the same command line in the same project must print the same envelope,
// byte for byte but for the instant it started, and exit the same way.
// It needs the Lean toolchain, so it runs under LAKATOS_PROVE_E2E=1 in
// `thales.yml` and skips elsewhere. lemma is this checkout's, through
// LAKATOS_LEMMA.
const e2e = process.env.LAKATOS_PROVE_E2E === "1";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const THALES = path.join(REPO, "thales");
const LEMMA = path.join(REPO, "lemma");
const TS_BIN = path.join(THALES, "dist", "cli.js");
const LEAN_BIN = path.join(THALES, ".lake", "build", "bin", "thales");
const FIXTURES = path.join(THALES, "tests", "fixtures");
const CORPUS = path.join(THALES, "tests", "conformance");

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  LAKATOS_LEMMA: LEMMA,
  // Envelopes are compared, not models: one heartbeat settles every
  // correspondence proof in milliseconds.
  LAKATOS_PROVE_VALIDATE_HEARTBEATS: "1",
};

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function lean(cwd: string, args: string[], env = ENV): Run {
  const r = spawnSync(LEAN_BIN, args, { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function typescript(cwd: string, args: string[], env = ENV): Run {
  const r = spawnSync(process.execPath, [TS_BIN, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The parts of a run that differ between two runs of the same input:
 * the instant each started, which also names its run directory. */
function settled(text: string): string {
  return text.replace(/\d{4}-\d\d-\d\dT[\d:.-]+Z(-\d+)?/g, "<startedAt>");
}

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

/** Two copies of a scratch project, one per tool, so neither run sees the
 * other's run directory. */
function projects(
  files: Record<string, string | { copy: string }>,
  tsconfig = true,
): [string, string] {
  const base = mkdtempSync(path.join(tmpdir(), "thales-lean-exe-"));
  scratch.push(base);
  const dirs = ["lean", "ts"].map((name) => {
    const dir = path.join(base, name, "project");
    for (const [file, from] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      if (typeof from === "string") writeFileSync(path.join(dir, file), from);
      else copyFileSync(from.copy, path.join(dir, file));
    }
    mkdirSync(dir, { recursive: true });
    if (tsconfig && !("tsconfig.json" in files))
      writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
    return dir;
  });
  return [dirs[0]!, dirs[1]!];
}

/** Run both tools over the same project and expect the same answer. */
function expectParity(
  files: Record<string, string | { copy: string }>,
  args: string[],
  tsconfig = true,
): Run {
  const [leanDir, tsDir] = projects(files, tsconfig);
  const l = lean(leanDir, args);
  const t = typescript(tsDir, args);
  // The two copies differ by their directory's name alone.
  const lp = (text: string) =>
    settled(text).replaceAll("/lean/project", "/<p>");
  const tp = (text: string) => settled(text).replaceAll("/ts/project", "/<p>");
  expect({ code: l.code, stderr: lp(l.stderr) }).toEqual({
    code: t.code,
    stderr: tp(t.stderr),
  });
  expect(lp(l.stdout)).toBe(tp(t.stdout));
  if (l.stdout !== "") expectValidEnvelope(JSON.parse(l.stdout));
  return l;
}

const ANNOTATED = `/**
 * @ensures{nonNegative} result >= 0
 */
export function sq(x: number): number {
  return x * x;
}
`;

beforeAll(() => {
  if (!e2e) return;
  const built = spawnSync("lake", ["build", "thales"], {
    cwd: THALES,
    encoding: "utf8",
    timeout: BUILD_TIMEOUT_MS,
  });
  expect(built.status, built.stdout + built.stderr).toBe(0);
  expect(existsSync(TS_BIN)).toBe(true);
  expect(existsSync(path.join(LEMMA, "dist", "cli.js"))).toBe(true);
}, BUILD_TIMEOUT_MS + 60_000);

describe.runIf(e2e)("the Lean thales: its command line", () => {
  it("--help prints the help and exits 0", () => {
    const r = lean(REPO, ["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^usage: thales \[files-or-globs\.\.\.\]/);
  });

  it("an unknown option is a usage error", () => {
    const r = lean(REPO, ["--nope"]);
    expect(r).toEqual({
      code: 2,
      stdout: "",
      stderr: "usage: thales [files-or-globs...]\n",
    });
  });

  it("a lemma that cannot be had is exit 2, no envelope", () => {
    const [dir] = projects({ "a.ts": ANNOTATED });
    const r = lean(dir, ["a.ts"], {
      ...ENV,
      LAKATOS_LEMMA: path.join(dir, "no-lemma"),
    });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^error: LAKATOS_LEMMA=.*no-lemma has no /);
  });
});

describe.runIf(e2e)("the Lean thales answers as the TypeScript one", () => {
  it("a pattern matching nothing", () => {
    const r = expectParity({ "a.ts": ANNOTATED }, ["nope/*.ts"]);
    expect(r.code).toBe(2);
  });

  it("no tsconfig.json: every annotation InputError, no run directory", () => {
    const r = expectParity({ "a.ts": ANNOTATED }, ["a.ts"], false);
    expect(r.code).toBe(2);
  });

  it("a program that does not type check", () => {
    const r = expectParity(
      { "a.ts": ANNOTATED, "b.ts": "export const n: number = 'x';\n" },
      ["a.ts"],
    );
    expect(r.code).toBe(2);
  });

  it("a named file the program leaves out, beside one it checks", () => {
    const r = expectParity(
      {
        "src/a.ts": ANNOTATED,
        "out/b.ts": ANNOTATED,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { target: "es2022", module: "nodenext", types: [] },
          include: ["src/**/*.ts"],
        }),
      },
      ["src/a.ts", "out/b.ts"],
    );
    expect(r.code).toBe(2);
  });

  it("an annotation extraction refuses, and one the formula typing refuses", () => {
    const r = expectParity(
      {
        "a.ts": `${ANNOTATED}
/**
 * @ensures{dup} result >= 0
 * @ensures{dup} result >= 0
 */
export function twice(x: number): number {
  return x;
}

/**
 * @ensures{typed} result.length >= 0
 */
export function typed(x: number): number {
  return x;
}
`,
      },
      ["a.ts"],
    );
    expect(r.code).toBe(2);
  });

  it("patterns resolve as admit resolves them", () => {
    // Normalized and deduplicated: one file, spelled one way.
    expectParity({ "a.ts": ANNOTATED }, ["./a.ts", "a.ts"]);
  });

  it("a directory or a JavaScript file matches no .ts file", () => {
    for (const arg of ["src", "b.js"]) {
      const r = expectParity(
        { "src/a.ts": ANNOTATED, "b.js": "export const b = 1;\n" },
        [arg],
      );
      expect(r.code).toBe(2);
    }
  });

  it("discovery through tsconfig.json when no files are named", () => {
    expectParity({ "a.ts": ANNOTATED, "b.ts": "export const k = 1;\n" }, []);
  });

  it(
    "the tracer and two refuted fixtures, proved",
    { timeout: 3 * LEAN_TIMEOUT_MS },
    () => {
      const r = expectParity(
        {
          "tracer.ts": { copy: path.join(FIXTURES, "tracer.ts") },
          "unique.ts": {
            copy: path.join(CORPUS, "countersatisfiable", "zero-edge.ts"),
          },
          "comm.ts": {
            copy: path.join(CORPUS, "countersatisfiable", "commutes.ts"),
          },
        },
        ["tracer.ts", "unique.ts", "comm.ts"],
      );
      expect(r.code).toBe(1);
    },
  );
});

describe.runIf(e2e)("the Lean thales, interrupted", () => {
  it(
    "SIGINT to its process group reports the tried annotations as User",
    { timeout: LEAN_TIMEOUT_MS },
    async () => {
      const [dir] = projects({
        "tracer.ts": { copy: path.join(FIXTURES, "tracer.ts") },
      });
      // At the real correspondence budget the artifact runs for tens of
      // seconds: time enough to be interrupted mid-run.
      const env = { ...ENV };
      delete env.LAKATOS_PROVE_VALIDATE_HEARTBEATS;
      const child = spawn(LEAN_BIN, ["tracer.ts"], {
        cwd: dir,
        env,
        detached: true,
      });
      let stdout = "";
      let stderr = "";
      let sent = false;
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
        // Once the plan is announced the engine is running: interrupt the
        // whole group, as Ctrl-C at a terminal does, once.
        if (sent || !/emitted \d+ annotation/.test(stderr)) return;
        sent = true;
        setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGINT");
          } catch {
            // The run finished first; the assertions below say so.
          }
        }, 2000);
      });
      const code = await new Promise<number | null>((resolve) =>
        child.on("close", resolve),
      );
      expect(code, stderr).toBe(2);
      expect(stderr).toContain(
        "thales: interrupted by SIGINT; reporting 1 annotation as User",
      );
      const envelope = JSON.parse(stdout) as {
        annotations: { szs: string; reason?: string }[];
      };
      expectValidEnvelope(envelope);
      expect(envelope.annotations.map((a) => a.szs)).toContain("User");
      expect(envelope.annotations.find((a) => a.szs === "User")?.reason).toBe(
        "the run was interrupted (SIGINT)",
      );
    },
  );
});
