import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILD_TIMEOUT_MS,
  ensureBinary,
  findTarskiRoot,
} from "../src/index.js";

// `tarski <file.ts>` against the real binary and the real lemma: the Lean
// executable that replaced `thales-exe`. It needs the Lean toolchain, so
// it runs under LAKATOS_TARSKI_E2E=1 in `tarski.yml` and skips elsewhere.
//
// lemma is this checkout's, through LAKATOS_LEMMA, except in the resolver
// cases, which put a fake `npm` on PATH and a scratch HOME under the
// binary to watch the pinned release be installed and reused.
const e2e = process.env.LAKATOS_TARSKI_E2E === "1";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const LEMMA = path.join(REPO, "lemma");

/** The first case may pay for one `lake build tarski`. */
const FIRST_TIMEOUT_MS = BUILD_TIMEOUT_MS + 60_000;

const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

let binary = "";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function tarski(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = { ...process.env, LAKATOS_LEMMA: LEMMA },
): Run {
  const r = spawnSync(binary, args, { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A scratch project holding `files`, with a default tsconfig.json unless
 * `files` brings its own or `tsconfig` is false. */
function project(
  files: Record<string, string>,
  tsconfig = true,
): { dir: string; run: (...args: string[]) => Run } {
  const dir = mkdtempSync(path.join(tmpdir(), "tarski-exe-e2e-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  if (tsconfig && !("tsconfig.json" in files))
    writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  return { dir, run: (...args) => tarski(dir, args) };
}

// Every suite below runs the binary, so it is built once, ahead of all of
// them, whichever are selected.
beforeAll(() => {
  if (!e2e) return;
  const built = ensureBinary(findTarskiRoot());
  expect(built.kind, JSON.stringify(built)).toBe("ready");
  if (built.kind === "ready") binary = built.binary;
  expect(existsSync(path.join(LEMMA, "dist", "cli.js"))).toBe(true);
}, FIRST_TIMEOUT_MS);

const scratch: string[] = [];
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});
function tracked<T extends { dir: string }>(p: T): T {
  scratch.push(p.dir);
  return p;
}

describe.runIf(e2e)("tarski <file.ts>", () => {
  let p: ReturnType<typeof project>;
  beforeAll(() => {
    p = tracked(
      project({
        // #386's example, verbatim.
        "foo.ts":
          'export function inv(x: number): number { if (x === 0) throw new RangeError("zero"); return 1 / x; }\n' +
          "console.log(inv(4));\n" +
          "console.log(inv(0));\n",
        "clean.ts": 'console.log("a", 1);\n',
        "last.ts": "const k: number = 2;\nk + 1;\n",
        "regex.ts": "const r: RegExp = /x/;\nconsole.log(r.source);\n",
      }),
    );
  }, FIRST_TIMEOUT_MS);

  it("prints what ran and reports the uncaught throw, exiting 1", () => {
    const r = p.run("foo.ts");
    expect(r.stdout).toBe("0.25\n");
    expect(r.stderr).toBe("Uncaught RangeError: zero\n");
    expect(r.code).toBe(1);
  });

  it("forwards every argument of a console.log call", () => {
    const r = p.run("clean.ts");
    expect(r).toEqual({ code: 0, stdout: "a 1\n", stderr: "" });
  });

  // As `node file.js` prints none: a program runs for its effects.
  it("prints no completion value", () => {
    expect(p.run("last.ts")).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("names the syntax the evaluator does not know and exits 2", () => {
    const r = p.run("regex.ts");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      "tarski: regex.ts: unsupported syntax: RegularExpressionLiteral\n",
    );
  });

  it("states the evaluator's honesty limits under --help", () => {
    const r = p.run("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^usage: tarski <file\.ts>/);
    const prose = r.stdout.replace(/\s+/g, " ");
    expect(prose).toContain(
      "a proof's model is checked against the evaluator per declaration",
    );
    expect(prose).toContain("refute runs on Node");
    expect(prose).toContain("lemma@0.2.0");
    expect(p.run("-h").stdout).toBe(r.stdout);
  });

  for (const args of [[], ["clean.ts", "last.ts"], ["--seed", "3"], ["-x"]])
    it(`refuses ${JSON.stringify(args)} with usage and exit 2`, () => {
      const r = p.run(...args);
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toMatch(/^usage: tarski <file\.ts>\n/);
    });

  it("refuses a file that is not there as outside the program", () => {
    const r = p.run("no-such-file.ts");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      "tarski: no-such-file.ts is not part of the program tsconfig.json describes, so it was not type checked\n",
    );
  });

  it("shares thales's gate cache", () => {
    expect(existsSync(path.join(p.dir, ".lakatos/typecheck.tsbuildinfo"))).toBe(
      true,
    );
  });
});

describe.runIf(e2e)("tarski's typecheck gate", () => {
  it("refuses a project with no tsconfig.json", () => {
    const p = tracked(project({ "a.ts": "console.log(1);\n" }, false));
    const r = p.run("a.ts");
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^tarski: no tsconfig\.json: /);
  });

  it("reports each diagnostic and refuses an ill-typed program", () => {
    const p = tracked(project({ "bad.ts": "const n: number = 'x';\n" }));
    const r = p.run("bad.ts");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      "error: bad.ts:1: TS2322: Type 'string' is not assignable to type 'number'.\n" +
        "tarski: the program does not type check under lakatos's required options\n",
    );
  });

  it("refuses a file the tsconfig's program leaves out", () => {
    const p = tracked(
      project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { target: "es2022", module: "nodenext", types: [] },
          include: ["src"],
          exclude: [".lakatos"],
        }),
        "src/inside.ts": "const k: number = 1;\n",
        "not-in-tsconfig.ts": 'console.log("never");\n',
      }),
    );
    const r = p.run("not-in-tsconfig.ts");
    expect(r.code).toBe(2);
    expect(r.stderr).toBe(
      "tarski: not-in-tsconfig.ts is not part of the program tsconfig.json describes, so it was not type checked\n",
    );
  });

  it("refuses a file with a formula Lemma cannot read", () => {
    const p = tracked(
      project({
        "f.ts":
          "/** @ensures{p} forall (n: int) { forall (m: int) { f(n) === m } } */\n" +
          "export function f(n: number): number { return n; }\n",
      }),
    );
    const r = p.run("f.ts");
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^tarski: f\.ts:1: @ensures\{p\}: /);
  });
});

describe.runIf(e2e)("tarski without LAKATOS_LEMMA", () => {
  let home = "";
  let fakeBin = "";
  let log = "";
  let p: ReturnType<typeof project>;
  const cache = () => path.join(home, ".cache", "lakatos", "lemma@0.2.0");

  /** A run with the fake npm first on PATH and the scratch HOME. */
  const run = (env: NodeJS.ProcessEnv = {}): Run => {
    const { LAKATOS_LEMMA: _, ...rest } = process.env;
    return tarski(p.dir, ["clean.ts"], {
      ...rest,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_NPM_LOG: log,
      FAKE_NPM_LEMMA: LEMMA,
      ...env,
    });
  };
  const installs = (): number =>
    existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter(Boolean).length
      : 0;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), "tarski-exe-home-"));
    scratch.push(home);
    fakeBin = path.join(home, "bin");
    log = path.join(home, "npm.log");
    mkdirSync(fakeBin);
    // `npm install --prefix <dir> … @lakatos/lemma@<v>`, faked: the
    // package is this checkout's built lemma under the version the fake is
    // told to claim. `dist` is a link, so node resolves lemma's own
    // dependencies from the checkout.
    const npm = path.join(fakeBin, "npm");
    writeFileSync(
      npm,
      [
        "#!/bin/sh",
        'echo "$@" >> "$FAKE_NPM_LOG"',
        'if [ -n "$FAKE_NPM_FAIL" ]; then echo "npm error 404 Not Found" >&2; exit 1; fi',
        'if [ -n "$FAKE_NPM_SLEEP" ]; then sleep "$FAKE_NPM_SLEEP"; fi',
        'pkg="$3/node_modules/@lakatos/lemma"',
        'mkdir -p "$pkg"',
        `printf '{"name":"@lakatos/lemma","version":"%s"}' "\${FAKE_NPM_VERSION:-0.2.0}" > "$pkg/package.json"`,
        'ln -s "$FAKE_NPM_LEMMA/dist" "$pkg/dist"',
        "",
      ].join("\n"),
    );
    chmodSync(npm, 0o755);
    p = tracked(project({ "clean.ts": 'console.log("a", 1);\n' }));
  });

  it("answers exit 2, not an uncaught 1, when HOME is empty", () => {
    const r = run({ HOME: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^tarski: HOME is not set/);
  });

  it("explains a failed install and names the override", () => {
    const r = run({ FAKE_NPM_FAIL: "1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "tarski: npm could not install @lakatos/lemma@0.2.0",
    );
    expect(r.stderr).toContain("npm error 404 Not Found");
    expect(r.stderr).toContain("set LAKATOS_LEMMA");
    expect(existsSync(cache())).toBe(false);
  });

  it("refuses a release that is not the pinned one", () => {
    const r = run({ FAKE_NPM_VERSION: "0.1.9" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "npm installed @lakatos/lemma 0.1.9, not the pinned 0.2.0",
    );
    expect(existsSync(cache())).toBe(false);
  });

  it("installs the pinned release once, then runs node on it", () => {
    const before = installs();
    expect(run()).toEqual({ code: 0, stdout: "a 1\n", stderr: "" });
    expect(installs()).toBe(before + 1);
    expect(readFileSync(log, "utf8")).toContain("lemma@0.2.0");
    expect(
      existsSync(path.join(cache(), "node_modules/@lakatos/lemma/dist/cli.js")),
    ).toBe(true);
    expect(run()).toEqual({ code: 0, stdout: "a 1\n", stderr: "" });
    expect(installs()).toBe(before + 1);
  });

  it("replaces a cached release whose version is not the pin", () => {
    writeFileSync(
      path.join(cache(), "node_modules/@lakatos/lemma/package.json"),
      '{"name":"@lakatos/lemma","version":"0.1.0"}',
    );
    const before = installs();
    expect(run().code).toBe(0);
    expect(installs()).toBe(before + 1);
  });

  // Cold-cache runs racing, as parallel test262 workers will: each
  // installs, the first rename wins, and every run uses a whole copy.
  it("lets runs racing on a cold cache all succeed", async () => {
    rmSync(cache(), { recursive: true, force: true });
    const { LAKATOS_LEMMA: _, ...rest } = process.env;
    const env = {
      ...rest,
      HOME: home,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      FAKE_NPM_LOG: log,
      FAKE_NPM_LEMMA: LEMMA,
      FAKE_NPM_SLEEP: "1",
    };
    const codes = await Promise.all(
      Array.from(
        { length: 6 },
        () =>
          new Promise<number | null>((resolve) => {
            const child = spawn(binary, ["clean.ts"], {
              cwd: p.dir,
              env,
              stdio: "ignore",
            });
            child.on("close", resolve);
          }),
      ),
    );
    expect(codes).toEqual([0, 0, 0, 0, 0, 0]);
    const parent = path.dirname(cache());
    expect(readdirSync(parent)).toEqual(["lemma@0.2.0"]);
  });
});

/** A stand-in lemma checkout whose bin is `script`. */
function fakeLemma(script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tarski-fake-lemma-"));
  scratch.push(dir);
  mkdirSync(path.join(dir, "dist"));
  writeFileSync(path.join(dir, "dist", "cli.js"), script);
  return dir;
}

describe.runIf(e2e)("tarski when lemma misbehaves", () => {
  let p: ReturnType<typeof project>;
  beforeAll(() => {
    p = tracked(project({ "a.ts": "console.log(1);\n" }));
  });
  const withLemma = (dir: string): Run =>
    tarski(p.dir, ["a.ts"], { ...process.env, LAKATOS_LEMMA: dir });

  it("reports a lemma checkout with no bin built", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tarski-no-dist-"));
    scratch.push(dir);
    const r = withLemma(dir);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("has no");
    expect(r.stderr).toContain("build lemma first");
  });

  it("reports a crash with lemma's own stderr, exit 2", () => {
    const r = withLemma(fakeLemma('throw new Error("emitter bug");\n'));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("tarski: lemma answered for");
    expect(r.stderr).toContain("emitter bug");
  });

  it("does not run a program lemma crashed after printing", () => {
    const doc = {
      schemaVersion: 0,
      file: "a.ts",
      gated: true,
      outcome: "program",
      program: { type: "Program", body: [] },
    };
    const r = withLemma(
      fakeLemma(
        `process.stdout.write(${JSON.stringify(JSON.stringify(doc) + "\n")});\n` +
          'throw new Error("late crash");\n',
      ),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("which is a crash");
    expect(r.stderr).toContain("late crash");
  });

  it("refuses a document of another version", () => {
    const doc = { schemaVersion: 1, file: "a.ts" };
    const r = withLemma(
      fakeLemma(`console.log(${JSON.stringify(JSON.stringify(doc))});\n`),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(
      "lemma document version 1, but this executable reads version 0",
    );
  });
});
