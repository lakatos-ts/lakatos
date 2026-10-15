// The checked-program document: what the `lemma` bin prints for one file,
// and what an engine on the other side of a process boundary reads.
// `schemas/lemma-document.schema.json` is the same contract as JSON Schema.
//
// Every input file gets a document, refused or not, so a caller reading a
// batch never has to match stderr lines back to files: a refusal is data,
// with its reason and, for the gate, the compiler's diagnostics.

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import {
  NO_TSCONFIG,
  outsideProgram,
  readFormulas,
  refusalsOf,
  typingRefusals,
  typecheckFailure,
} from "./admit.js";
import { type Emission, emitModule, type PlainEmission } from "./emission.js";
import { resolveFiles } from "./discover.js";
import { LemmaError } from "./errors.js";
import {
  extractFromSource,
  type InvalidAnnotation,
  type RawAnnotation,
} from "./extract.js";
import { ParseError, parseScript, type Program } from "./estree.js";
import { typeFormulas, type ParsedFile } from "./island-types.js";
import { annotationKey, qualifiedName } from "./qualified-name.js";
import { stripTypes } from "./strip-types.js";
import { type TypecheckDiagnostic, typecheckProject } from "./typecheck.js";

/** Bumped on every change a reader of an older document would misread.
 * 1: every `check` document carries `annotations`, each with its outcome. */
export const SCHEMA_VERSION = 1;

/** What became of one `@ensures`: an obligation the engine will attempt,
 * a verdict the emitter settled itself, or an input error with the cause
 * the envelope orders refusals by. */
export type AnnotationOutcome =
  | { outcome: "tried" }
  | {
      outcome: "classified";
      szs: "Inappropriate" | "Error" | "NotTried";
      kind?: "unsupported-range";
      reason: string;
    }
  | {
      outcome: "refused";
      cause: "extraction" | "typing" | "gate";
      /** Spelled as `admit` spells it: the envelope's `error`. */
      error: string;
    };

export type DocumentAnnotation = {
  /** Qualified: `add`, `Point#dist`, `Point.make`. */
  function: string;
  property: string;
  line: number;
} & AnnotationOutcome;

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
  /** Every `@ensures` in the file, on `check` documents only. */
  annotations?: DocumentAnnotation[];
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

function identityOf(a: RawAnnotation | InvalidAnnotation) {
  return {
    function: qualifiedName(a.functionName, a.className, a.isStatic),
    property: a.propertyName,
    line: a.line,
  };
}

/** The outcomes of an admitted file: the extracted annotations in order
 * (tried, classified, or refused by the gate's typing), then the ones
 * extraction refused. `allExtracted` is the unfiltered list: the emitter
 * drops typing-refused annotations from its own. */
function admittedAnnotations(
  file: string,
  emitted: PlainEmission,
  typingRefused: ReadonlyMap<string, string>,
  allExtracted: RawAnnotation[],
): DocumentAnnotation[] {
  const error = (i: InvalidAnnotation) => refusalsOf(file, [i])[0]!.error;
  const out: DocumentAnnotation[] = [];
  for (const a of allExtracted) {
    const id = identityOf(a);
    const t = typingRefused.get(annotationKey(file, a));
    if (t !== undefined) {
      out.push({ ...id, outcome: "refused", cause: "typing", error: t });
      continue;
    }
    const c = emitted.classified.find(
      (x) =>
        x.annotation.line === a.line &&
        x.annotation.propertyName === a.propertyName &&
        identityOf(x.annotation).function === id.function,
    );
    out.push(
      c === undefined
        ? { ...id, outcome: "tried" }
        : {
            ...id,
            outcome: "classified",
            szs: c.szs,
            ...(c.kind === undefined ? {} : { kind: c.kind }),
            reason: c.reason,
          },
    );
  }
  for (const i of emitted.invalid)
    out.push({
      ...identityOf(i),
      outcome: "refused",
      cause: "extraction",
      error: error(i),
    });
  return out;
}

/** Every annotation in `file` refused at the gate with `error`, then the
 * ones extraction refused: `admit`'s order and `admit`'s spellings. */
function gateRefusals(file: string, error: string): DocumentAnnotation[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    // A file that is not there has no annotations to refuse.
    return [];
  }
  const extracted = extractFromSource(text, file);
  const spelled = refusalsOf(file, extracted.invalid);
  return [
    ...extracted.annotations.map((a): DocumentAnnotation => ({
      ...identityOf(a),
      outcome: "refused",
      cause: "gate",
      error,
    })),
    ...extracted.invalid.map((i, n): DocumentAnnotation => ({
      ...identityOf(i),
      outcome: "refused",
      cause: "extraction",
      error: spelled[n]!.error,
    })),
  ];
}

/**
 * A file `admit` admitted, documented without running the gate again:
 * its types stripped and the script parsed, with the emission beside it.
 * `refused` holds the annotation keys the gate's formula typing refused,
 * each with `admit`'s diagnostic for it (`typingRefusals`); the emission
 * leaves those out and the document says why, so no refused annotation is
 * ever labeled `tried`. `emitted` is the emitter's whole answer,
 * for an engine in this process that also needs the annotations it
 * extracted and the ones it settled itself.
 */
export function admittedDocument(
  file: string,
  refused: ReadonlyMap<string, string>,
): { document: CheckedDocument; emitted: PlainEmission } {
  // The gate just read this file as part of the program, so a failure to
  // read it again is not the caller's to handle.
  const source = readFileSync(file, "utf8");
  const emitted = emitModule(source, file, undefined, new Set(refused.keys()));
  const annotations = admittedAnnotations(
    file,
    emitted,
    refused,
    extractFromSource(source, file).annotations,
  );
  return {
    document: {
      ...parsed(file, true, source, stripTypes(source, file), emitted.emission),
      annotations,
    },
    emitted,
  };
}

const NO_TSCONFIG_DOC =
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
    return files.map((file) => ({
      ...refused(file, true, "no-tsconfig", NO_TSCONFIG_DOC),
      annotations: gateRefusals(file, NO_TSCONFIG),
    }));
  if (check.kind === "failed") {
    const error = typecheckFailure(check.diagnostics);
    return files.map((file) => ({
      ...refused(file, true, "typecheck", NOT_CLEAN, check.diagnostics),
      annotations: gateRefusals(file, error),
    }));
  }
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
      const message = outsideProgram(file);
      answers.set(file, {
        ...refused(file, true, "outside-program", message),
        annotations: gateRefusals(file, message),
      });
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
  const typed = typeFormulas(formulas, check.checked);
  const typingOf = new Map(typed.invalid.map((t) => [t.file, t.invalid]));
  return files.map((file) => {
    const answer = answers.get(file);
    if (answer !== undefined) return answer;
    const as = typedAs.get(path.relative(cwd, path.resolve(file)))!;
    // Spelled under the name this file was given, not the one it was typed as.
    return admittedDocument(file, typingRefusals(file, typingOf.get(as) ?? []))
      .document;
  });
}

/** `checkDocuments` over patterns: the files they match, or, with none,
 * the files tsconfig.json compiles, as `admit` resolves them. Throws
 * LemmaError when resolution comes up empty or the tsconfig is broken. */
export function checkPatterns(
  patterns: readonly string[],
  tsBuildInfoFile?: string,
): CheckedDocument[] {
  // Lean callers match documents to the arguments as typed, so plain
  // existing files are answered unexpanded.
  const plain = patterns.length > 0 && patterns.every((p) => existsSync(p));
  return checkDocuments(
    plain ? [...patterns] : resolveFiles([...patterns]).files,
    tsBuildInfoFile,
  );
}
