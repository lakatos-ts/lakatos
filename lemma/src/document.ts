// The checked-program document: what the `lemma` bin prints for one file,
// and what an engine on the other side of a process boundary reads.
// `schemas/lemma-document.schema.json` is the same contract as JSON Schema.
//
// Every input file gets a document, refused or not, so a caller reading a
// batch never has to match stderr lines back to files: a refusal is data,
// with its reason and, for the gate, the compiler's diagnostics.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { readFormulas } from "./admit.js";
import { type Emission, emitModule, type PlainEmission } from "./emission.js";
import { LemmaError } from "./errors.js";
import { ParseError, parseScript, type Program } from "./estree.js";
import { typeFormulas, type ParsedFile } from "./island-types.js";
import { stripTypes } from "./strip-types.js";
import { type TypecheckDiagnostic, typecheckProject } from "./typecheck.js";

/** Bumped on every change a reader of an older document would misread. */
export const SCHEMA_VERSION = 0;

/** Why a file has no program. */
export type RefusalReason =
  /** `parse` could not read the file. `check` never says this: a file
   * the type check did not read is `outside-program`, whether or not it
   * exists. */
  | "unreadable"
  /** No tsconfig.json, so no options to type check under. */
  | "no-tsconfig"
  /** The project does not type check under lakatos's required options. */
  | "typecheck"
  /** The tsconfig's program leaves the file out, so it was not checked. */
  | "outside-program"
  /** A `@ensures` formula Lemma cannot read: a compile error, as a type
   * error is. */
  | "annotation"
  /** The source does not parse. */
  | "syntax";

export type CheckedDocument = {
  schemaVersion: typeof SCHEMA_VERSION;
  /** The path as the caller gave it. */
  file: string;
  /** Whether the program passed the typecheck gate on its way here. */
  gated: boolean;
} & (
  | {
      outcome: "program";
      /** The script the program was parsed from, when that is not the
       * file's own text: the TypeScript with its types stripped. */
      script?: string;
      /** thales's emission IR, on every `check` document whose file passed
       * the gate. */
      emission?: Emission;
      program: Program;
    }
  | {
      outcome: "refused";
      reason: RefusalReason;
      message: string;
      /** The gate's findings, for a `typecheck` refusal. */
      diagnostics?: TypecheckDiagnostic[];
      /** As on a program: a `syntax` refusal after the gate is the parser
       * disagreeing with `tsc`, not the file's fault, so the emission
       * stays. */
      emission?: Emission;
    }
);

type Refused = Extract<CheckedDocument, { outcome: "refused" }>;

function refused(
  file: string,
  gated: boolean,
  reason: RefusalReason,
  message: string,
  diagnostics?: TypecheckDiagnostic[],
): Refused {
  return {
    schemaVersion: SCHEMA_VERSION,
    file,
    gated,
    outcome: "refused",
    reason,
    message,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

function read(file: string): string | Refused {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    // readFileSync throws a SystemError, which is an Error.
    return refused(file, false, "unreadable", (e as Error).message);
  }
}

/** `parseScript`, with the one error it throws as a refusal. */
function parsed(
  file: string,
  gated: boolean,
  source: string,
  script?: string,
  emission?: Emission,
): CheckedDocument {
  const carried = emission === undefined ? {} : { emission };
  let program: Program;
  try {
    program = parseScript(script ?? source, file);
  } catch (e) {
    return {
      ...refused(file, gated, "syntax", (e as ParseError).message),
      ...carried,
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    file,
    gated,
    outcome: "program",
    ...(script === undefined ? {} : { script }),
    ...carried,
    program,
  };
}

/**
 * One JavaScript file as a script, with no gate and nothing stripped: the
 * text is parsed exactly as it is. This is test262's way in, where the
 * question is what the evaluator covers, not what `tsc` accepts. A
 * relative path is taken from the current directory.
 */
export function parseDocument(file: string): CheckedDocument {
  const source = read(path.resolve(file));
  if (typeof source !== "string") return { ...source, file };
  return parsed(file, false, source);
}

/**
 * A file `admit` admitted, documented without running the gate again:
 * its types stripped and the script parsed, with the emission beside it.
 * `refused` holds the annotation keys the gate's formula typing refused;
 * the emission leaves those out. `emitted` is the emitter's whole answer,
 * for an engine in this process that also needs the annotations it
 * extracted and the ones it settled itself.
 */
export function admittedDocument(
  file: string,
  refused: ReadonlySet<string> = new Set(),
): { document: CheckedDocument; emitted: PlainEmission } {
  // The gate just read this file as part of the program, so a failure to
  // read it again is not the caller's to handle.
  const source = readFileSync(file, "utf8");
  const emitted = emitModule(source, file, undefined, refused);
  return {
    document: parsed(
      file,
      true,
      source,
      stripTypes(source, file),
      emitted.emission,
    ),
    emitted,
  };
}

const NO_TSCONFIG =
  "no tsconfig.json: the program is type checked before it is parsed, " +
  "and the project's compiler options are needed to do so";

const NOT_CLEAN =
  "the program does not type check under lakatos's required options";

/**
 * TypeScript files through the gate, from the current directory, as
 * `admit` takes them: the project is type checked once, under its own
 * tsconfig.json with lakatos's required options forced on top, every
 * formula in the files the check covered is read and typed, and each of
 * those files is documented by `admittedDocument`. `tsBuildInfoFile` is
 * the gate's cache, as `typecheckProject` takes it.
 */
export function checkDocuments(
  files: readonly string[],
  tsBuildInfoFile?: string,
): CheckedDocument[] {
  const cwd = process.cwd();
  const check = typecheckProject(
    cwd,
    tsBuildInfoFile === undefined ? undefined : path.resolve(tsBuildInfoFile),
  );
  if (check.kind === "missing")
    return files.map((file) => refused(file, true, "no-tsconfig", NO_TSCONFIG));
  if (check.kind === "failed")
    return files.map((file) =>
      refused(file, true, "typecheck", NOT_CLEAN, check.diagnostics),
    );
  const program = new Set(check.programFiles);
  const answers = new Map<string, CheckedDocument>();
  const formulas: ParsedFile[] = [];
  // The spelling each checked file is typed under: formula typing keys
  // its work by source file, so a file named twice is typed once, and
  // its refusals are spelled again for every other name it was given.
  const typedAs = new Map<string, string>();
  for (const file of files) {
    const relative = path.relative(cwd, path.resolve(file));
    if (!program.has(relative)) {
      answers.set(
        file,
        refused(
          file,
          true,
          "outside-program",
          `${file} is not part of the program tsconfig.json describes, so it was not type checked`,
        ),
      );
      continue;
    }
    let read: ParsedFile[];
    try {
      read = readFormulas([file]);
    } catch (e) {
      /* v8 ignore next -- readFormulas rethrows only what is not a
         LemmaError, which is a bug, not this file's refusal */
      if (!(e instanceof LemmaError)) throw e;
      answers.set(file, refused(file, true, "annotation", e.message));
      continue;
    }
    if (typedAs.has(relative)) continue;
    typedAs.set(relative, file);
    formulas.push(...read);
  }
  const { refused: untyped } = typeFormulas(formulas, check.checked);
  return files.map((file) => {
    const answer = answers.get(file);
    if (answer !== undefined) return answer;
    const as = typedAs.get(path.relative(cwd, path.resolve(file)))!;
    return admittedDocument(
      file,
      as === file ? untyped : respelled(untyped, as, file),
    ).document;
  });
}

/** `keys`' annotation keys for `from`, spelled for `to` instead. */
function respelled(
  keys: ReadonlySet<string>,
  from: string,
  to: string,
): Set<string> {
  const out = new Set<string>();
  for (const key of keys) {
    const [file, ...rest] = JSON.parse(key) as string[];
    if (file === from) out.add(JSON.stringify([to, ...rest]));
  }
  return out;
}
