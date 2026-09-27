#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { prove } from "@lakatos/thales";
import { parseSeed, refute } from "@lakatos/pabst";
import {
  admit,
  annotationKey,
  clampedEndpoints,
  EmptyAfterClampError,
  extract,
  type InvalidAnnotation,
  LemmaError,
  parseBody,
  parsePrefix,
  qualifiedName,
  refusalsOf,
  resolveFiles,
  type TypecheckDiagnostic,
  typecheckProject,
  unsupportedRangeReason,
} from "@lakatos/lemma";
import {
  UNSUPPORTED_RANGE_KIND,
  type AnnotationResult,
} from "@lakatos/core/envelope";
import { executeSource } from "./exe.js";
import {
  claimRunDir,
  RUN_ROOT,
  RunDirError,
  TYPECHECK_CACHE,
} from "@lakatos/core/run-dir";
import { packageVersion, runTool, type Spine } from "@lakatos/core/runner";

function formatTsDiagnostic(d: TypecheckDiagnostic): string {
  const site = d.file !== undefined ? `${d.file}:${d.line}: ` : "";
  return `${site}TS${d.code}: ${d.message}`;
}

const NO_TSCONFIG =
  "no tsconfig.json: lakatos type checks the program before analyzing it " +
  "and needs the project's compiler options to do so";

function outsideProgram(file: string): string {
  return `${file} is not part of the program tsconfig.json describes, so it was not type checked`;
}

const EXE_USAGE = "usage: lakatos exe <file.ts>";

/** `exe`: one file, run on the tarski evaluator.
 *
 * It shares `prove`'s gate — the same `typecheckProject` call against the
 * same cache, and the same three refusals — and nothing else: there is no
 * envelope to emit (the issue says so), so no `Spine`, and no interrupt
 * guard, since Ctrl-C should end lakatos and the binary together exactly
 * as it would end `node`. The run directory is not announced either: this
 * command's stderr belongs to the program. */
async function runExe(patterns: string[]): Promise<number> {
  if (patterns.length !== 1) {
    console.error(EXE_USAGE);
    return 2;
  }
  // A glob is allowed, but it has to name one file: `exe` runs a program,
  // not a set of them.
  const { files } = resolveFiles(patterns);
  if (files.length !== 1) {
    console.error(EXE_USAGE);
    return 2;
  }
  const file = files[0]!;
  const check = typecheckProject(
    process.cwd(),
    path.resolve(RUN_ROOT, TYPECHECK_CACHE),
  );
  if (check.kind === "missing") {
    console.error(`lakatos: ${NO_TSCONFIG}`);
    return 2;
  }
  if (check.kind === "failed") {
    for (const d of check.diagnostics)
      console.error(`error: ${formatTsDiagnostic(d)}`);
    console.error(
      "lakatos: the program does not type check under lakatos's required options",
    );
    return 2;
  }
  if (!check.programFiles.includes(file)) {
    console.error(`lakatos: ${outsideProgram(file)}`);
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
      console.error(`lakatos: ${file}: unsupported syntax: ${outcome.node}`);
      return 2;
    case "no-project":
      console.error(`lakatos: ${outcome.message}`);
      return 2;
    case "build-failed":
      process.stderr.write(outcome.stdout);
      process.stderr.write(outcome.stderr);
      console.error("lakatos: lake build tarski failed");
      return 2;
    case "refused":
      process.stderr.write(outcome.stderr);
      console.error(
        "lakatos: the evaluator refused the document lakatos handed it",
      );
      return 2;
  }
}

const USAGE =
  "usage: lakatos <prove|refute|check|exe> [--seed <n>] [files-or-globs...]";

const HELP = `${USAGE}

commands:
  prove   emit Lean for each file and attempt a proof per annotation;
          artifacts land in .lakatos/<run>/thales/ (requires the Lean
          toolchain)
  refute  generate property tests from @ensures annotations, run them, and
          print a JSON report to stdout
  check   prove and refute combined (not implemented yet)
  exe     run one TypeScript file on the tarski evaluator (requires the Lean
          toolchain); console.log goes to stdout, an uncaught throw's class
          and message to stderr with exit 1

exe accepts exactly the programs prove accepts (the same typecheck gate) and
is honest to the same limits: a proof's model is checked against the
evaluator per declaration (the envelope's model field says whether, and why
not), and refute runs on Node, not on this evaluator.

when no files are given, lakatos discovers your sources: the files that
tsconfig.json would compile. declaration files (.d.ts) are skipped unless a
pattern names them.

every run type checks the whole project first, under the project's own
tsconfig.json with lakatos's required options (strict) forced on top. a
program that does not compile is refused (annotations report InputError,
exit 2); a run without a tsconfig.json is refused the same way, and so is
any named file the tsconfig's program leaves out.

options:
  --seed <n>  reproduce a prior refute run's generation (echoed in the report)
  -h, --help  show this help`;

const COMMANDS = ["prove", "refute", "check", "exe"] as const;
type Command = (typeof COMMANDS)[number];

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  // parseArgs throws on unknown options and the like — usage errors, which
  // map to the documented exit-2 mode; anything else crashes loudly.
  let positionals: string[];
  let values: { seed?: string; help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        seed: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
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
  const command = positionals[0];
  const patterns = positionals.slice(1);
  if (!COMMANDS.includes(command as Command)) {
    console.error(USAGE);
    return 2;
  }
  // User-facing errors below — a bad --seed, file resolution coming up
  // empty, a malformed tsconfig, compile errors, an unusable run root — are
  // LemmaErrors or RunDirErrors and map to the documented exit-2 error
  // mode; anything else is an internal bug and crashes loudly.
  try {
    // exe has no envelope and so no spine: it is the one verb whose stdout
    // is the program's rather than lakatos's.
    if (command === "exe") return await runExe(patterns);
    // The seed is parsed before anything else so a bad one is reported
    // without first resolving files.
    if (command === "refute")
      return (
        await refute(
          patterns,
          values.seed !== undefined ? { seed: parseSeed(values.seed) } : {},
        )
      ).code;
    if (command === "prove") return (await prove(patterns)).code;
    // Awaited, not returned: the catch below must see the run's rejection.
    const report = await runTool(
      { name: "lakatos", version: packageVersion(import.meta.url) },
      (note) => admit(patterns, path.resolve(RUN_ROOT, TYPECHECK_CACHE), note),
      stubSpine(command as Command),
    );
    return report.code;
  } catch (e) {
    if (e instanceof LemmaError || e instanceof RunDirError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

/** The engine-independent enumeration: every annotation lemma can extract
 * and parse, as the NotTried entries a command with no engine reports,
 * plus the extraction-level input errors beside them. A formula lemma
 * itself cannot read is a compile error whichever command asked; a domain
 * the safe-integer clamp empties is refused per annotation, as both
 * engines refuse it. */
function enumerate(
  files: string[],
  refused: ReadonlySet<string>,
): {
  untried: AnnotationResult[];
  invalid: { file: string; invalid: InvalidAnnotation[] }[];
} {
  const untried: AnnotationResult[] = [];
  const invalid: { file: string; invalid: InvalidAnnotation[] }[] = [];
  for (const file of files) {
    const extracted = extract(file);
    invalid.push({ file, invalid: extracted.invalid });
    for (const a of extracted.annotations) {
      if (refused.has(annotationKey(file, a))) continue;
      const identity = {
        file,
        function: qualifiedName(a.functionName, a.className, a.isStatic),
        property: a.propertyName,
      };
      try {
        const { binders, body } = parsePrefix(a.formula);
        parseBody(body);
        // Asked after the body parses, so the clamp is reported only when
        // it is the sole blocker.
        const clamped = binders.flatMap(clampedEndpoints);
        if (clamped.length > 0) {
          untried.push({
            ...identity,
            szs: "NotTried",
            kind: UNSUPPORTED_RANGE_KIND,
            reason: unsupportedRangeReason(clamped),
          });
          continue;
        }
      } catch (e) {
        // Before the LemmaError arm: EmptyAfterClampError extends it.
        if (e instanceof EmptyAfterClampError) {
          untried.push({
            ...identity,
            szs: "NotTried",
            kind: UNSUPPORTED_RANGE_KIND,
            reason: unsupportedRangeReason(e.endpoints),
          });
          continue;
        }
        if (e instanceof LemmaError)
          throw new LemmaError(
            `${file}:${a.line}: @ensures{${a.propertyName}}: ${e.message}`,
            { cause: e },
          );
        throw e;
      }
      untried.push({ ...identity, szs: "NotTried" });
    }
  }
  return { untried, invalid };
}

/** A command with no engine yet: it enumerates what it would have attempted
 * and reports every annotation NotTried. */
function stubSpine(command: Command): Spine {
  return {
    plan(files, _runDir, refused) {
      const { untried, invalid } = enumerate(files, refused);
      return {
        identities: [],
        untried,
        inputErrors: invalid.flatMap(({ file, invalid }) =>
          refusalsOf(file, invalid),
        ),
        notes: [{ level: "info", text: `${command} is not implemented yet` }],
        degraded: false,
        outFiles: [],
        meta: {},
        emptyMeta: {},
        emptyExit: 1,
      };
    },
  };
}

// npm installs the bin as a symlink (node_modules/.bin/lakatos -> this
// file). Node resolves the main module to its realpath, but argv[1] keeps
// the symlink path, so argv[1] must be realpath'd before comparing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exit(await main());
}
