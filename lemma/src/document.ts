// The checked-program document: what the `lemma` bin prints for one file,
// and what an engine on the other side of a process boundary reads.
// `schemas/lemma-document.schema.json` is the same contract as JSON Schema.
//
// Every input file gets a document, refused or not, so a caller reading a
// batch never has to match stderr lines back to files: a refusal is data,
// with its reason and, for the gate, the compiler's diagnostics.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { ParseError, parseScript, type Program } from "./estree.js";
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
      program: Program;
    }
  | {
      outcome: "refused";
      reason: RefusalReason;
      message: string;
      /** The gate's findings, for a `typecheck` refusal. */
      diagnostics?: TypecheckDiagnostic[];
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
): CheckedDocument {
  let program: Program;
  try {
    program = parseScript(script ?? source, file);
  } catch (e) {
    return refused(file, gated, "syntax", (e as ParseError).message);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    file,
    gated,
    outcome: "program",
    ...(script === undefined ? {} : { script }),
    program,
  };
}

/**
 * One JavaScript file as a script, with no gate and nothing stripped: the
 * text is parsed exactly as it is. This is test262's way in, where the
 * question is what the evaluator covers, not what `tsc` accepts.
 */
export function parseDocument(
  file: string,
  cwd: string = process.cwd(),
): CheckedDocument {
  const source = read(path.resolve(cwd, file));
  if (typeof source !== "string") return { ...source, file };
  return parsed(file, false, source);
}

const NO_TSCONFIG =
  "no tsconfig.json: the program is type checked before it is parsed, " +
  "and the project's compiler options are needed to do so";

const NOT_CLEAN =
  "the program does not type check under lakatos's required options";

/**
 * TypeScript files through the gate: the project under `cwd` is type
 * checked once, under its own tsconfig.json with lakatos's required
 * options forced on top, and each file the check covered has its types
 * stripped and is parsed. `tsBuildInfoFile` is the gate's cache, as
 * `typecheckProject` takes it; a relative path is taken from `cwd`, like
 * the files.
 */
export function checkDocuments(
  files: readonly string[],
  cwd: string,
  tsBuildInfoFile?: string,
): CheckedDocument[] {
  const check = typecheckProject(
    cwd,
    tsBuildInfoFile === undefined
      ? undefined
      : path.resolve(cwd, tsBuildInfoFile),
  );
  return files.map((file) => {
    if (check.kind === "missing")
      return refused(file, true, "no-tsconfig", NO_TSCONFIG);
    if (check.kind === "failed")
      return refused(file, true, "typecheck", NOT_CLEAN, check.diagnostics);
    const relative = path.relative(cwd, path.resolve(cwd, file));
    if (!check.programFiles.includes(relative))
      return refused(
        file,
        true,
        "outside-program",
        `${file} is not part of the program tsconfig.json describes, so it was not type checked`,
      );
    // The check just read this file as part of the program, so a failure
    // to read it again is not the caller's to handle.
    const source = readFileSync(path.resolve(cwd, file), "utf8");
    return parsed(file, true, source, stripTypes(source, file));
  });
}
