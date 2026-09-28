#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  LemmaError,
  resolveFiles,
  type TypecheckDiagnostic,
  typecheckProject,
} from "@lakatos/lemma";
import {
  claimRunDir,
  RUN_ROOT,
  RunDirError,
  TYPECHECK_CACHE,
} from "@lakatos/core/run-dir";
import { executeSource } from "./exe.js";

const USAGE = "usage: thales-exe <file.ts>";

const HELP = `${USAGE}

run one TypeScript file on the tarski evaluator. console.log goes to
stdout; an uncaught throw's class and message go to stderr with exit 1.
artifacts land in .lakatos/<run>/tarski/. needs a lakatos checkout with
the Lean toolchain. the file may be a glob, as long as it names one file.

thales-exe accepts exactly the programs thales accepts (the same
typecheck gate). a proof's model is checked against the
evaluator per declaration (the envelope's model field says whether, and
why not), and refute runs on Node, not on this evaluator.

every run type checks the whole project first, under the project's own
tsconfig.json with lakatos's required options (strict) forced on top. a
program that does not compile is refused with exit 2, and so is a run
without a tsconfig.json or a file the tsconfig's program leaves out.

exit status: the program's own 0 or 1; 2 on bad input, a program the
evaluator does not support or refuses, or a missing or unbuildable
evaluator.

options:
  -h, --help  show this help`;

function formatTsDiagnostic(d: TypecheckDiagnostic): string {
  const site = d.file !== undefined ? `${d.file}:${d.line}: ` : "";
  return `${site}TS${d.code}: ${d.message}`;
}

const NO_TSCONFIG =
  "no tsconfig.json: thales-exe type checks the program before running it " +
  "and needs the project's compiler options to do so";

function outsideProgram(file: string): string {
  return `${file} is not part of the program tsconfig.json describes, so it was not type checked`;
}

/** It shares thales's gate — the same `typecheckProject` call against the
 * same cache, and the same three refusals — and nothing else: no envelope,
 * no interrupt guard (Ctrl-C ends it and the binary together, as it would
 * end `node`), and no announced run directory, since stderr is the
 * program's. */
async function runExe(patterns: string[]): Promise<number> {
  if (patterns.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const { files } = resolveFiles(patterns);
  if (files.length !== 1) {
    console.error(USAGE);
    return 2;
  }
  const file = files[0]!;
  const check = typecheckProject(
    process.cwd(),
    path.resolve(RUN_ROOT, TYPECHECK_CACHE),
  );
  if (check.kind === "missing") {
    console.error(`thales-exe: ${NO_TSCONFIG}`);
    return 2;
  }
  if (check.kind === "failed") {
    for (const d of check.diagnostics)
      console.error(`error: ${formatTsDiagnostic(d)}`);
    console.error(
      "thales-exe: the program does not type check under lakatos's required options",
    );
    return 2;
  }
  if (!check.programFiles.includes(file)) {
    console.error(`thales-exe: ${outsideProgram(file)}`);
    return 2;
  }
  const runDir = claimRunDir(new Date().toISOString());
  const outcome = executeSource(
    readFileSync(file, "utf8"),
    file,
    path.join(runDir, "tarski"),
  );
  switch (outcome.kind) {
    case "ran":
      // Both streams are the program's own, forwarded byte for byte.
      process.stdout.write(outcome.stdout);
      process.stderr.write(outcome.stderr);
      return outcome.status;
    case "unsupported":
      console.error(`thales-exe: ${file}: unsupported syntax: ${outcome.node}`);
      return 2;
    case "no-project":
      console.error(`thales-exe: ${outcome.message}`);
      return 2;
    case "build-failed":
      process.stderr.write(outcome.stdout);
      process.stderr.write(outcome.stderr);
      console.error("thales-exe: lake build tarski failed");
      return 2;
    case "refused":
      process.stderr.write(outcome.stderr);
      console.error(
        "thales-exe: the evaluator refused the document thales-exe handed it",
      );
      return 2;
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let positionals: string[];
  let values: { help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } },
    }));
  } catch (e) {
    if (
      e instanceof TypeError &&
      "code" in e &&
      typeof e.code === "string" &&
      e.code.startsWith("ERR_PARSE_ARGS_")
    ) {
      console.error(USAGE);
      return 2;
    }
    throw e;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  // Bad input maps to exit 2; anything else is an internal bug and crashes.
  try {
    return await runExe(positionals);
  } catch (e) {
    if (e instanceof LemmaError || e instanceof RunDirError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

// npm installs the bin as a symlink; Node resolves the main module to its
// realpath but argv[1] keeps the link, so compare realpaths.
/* v8 ignore start -- runs only in the spawned bin, which cli-bin.test.ts drives */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exit(await main());
}
/* v8 ignore stop */
