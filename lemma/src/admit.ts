import { resolveFiles } from "./discover.js";
import { LemmaError } from "./errors.js";
import { extract, type InvalidAnnotation } from "./extract.js";
import { parseBody } from "./formula-parser.js";
import {
  typeFormulas,
  type ParsedAnnotation,
  type ParsedFile,
} from "./island-types.js";
import { parsePrefix } from "./prefix-parser.js";
import { qualifiedName } from "./qualified-name.js";
import { EmptyAfterClampError } from "./range.js";
import { typecheckProject, type TypecheckDiagnostic } from "./typecheck.js";

/** An annotation refused as bad input, with its diagnostic. */
export interface Refusal {
  file: string;
  function: string;
  property: string;
  error: string;
}

/** A stderr line, in order: `error` prints as `error: <text>`, `info`
 * under the running tool's name. */
export interface Note {
  level: "error" | "info";
  text: string;
}

/** The gate's verdict on a command line. Refused stops the whole run;
 * admitted names the checked files and the annotation keys the engines
 * skip because a refusal already covers them. */
export type Admission =
  | { kind: "refused"; refusals: Refusal[]; notes: Note[] }
  | {
      kind: "admitted";
      files: string[];
      refused: ReadonlySet<string>;
      refusals: Refusal[];
      notes: Note[];
    };

const NO_TSCONFIG =
  "no tsconfig.json: lakatos type checks the program before analyzing it " +
  "and needs the project's compiler options to do so";

function outsideProgram(file: string): string {
  return `${file} is not part of the program tsconfig.json describes, so it was not type checked`;
}

function formatTsDiagnostic(d: TypecheckDiagnostic): string {
  const site = d.file !== undefined ? `${d.file}:${d.line}: ` : "";
  return `${site}TS${d.code}: ${d.message}`;
}

function typecheckFailure(diagnostics: TypecheckDiagnostic[]): string {
  const rest = diagnostics.length - 1;
  return (
    `the program does not type check: ${formatTsDiagnostic(diagnostics[0]!)}` +
    (rest > 0 ? ` (and ${rest} more)` : "")
  );
}

const annotations = (n: number): string =>
  `${n} annotation${n === 1 ? "" : "s"}`;

const echo = (refusals: Refusal[]): Note[] =>
  refusals.map((r) => ({ level: "error", text: r.error }));

/** Extraction-level input errors, `file:line:`-prefixed like a compile error. */
export function refusalsOf(
  file: string,
  invalid: InvalidAnnotation[],
): Refusal[] {
  return invalid.map((i) => ({
    file,
    function: qualifiedName(i.functionName, i.className, i.isStatic),
    property: i.propertyName,
    error: `${file}:${i.line}: ${i.message}`,
  }));
}

/** Every extractable annotation in `files` refused with `error`, then the
 * extraction-level input errors found on the way; only those are echoed. */
function refuseFiles(
  files: string[],
  error: string,
): { refusals: Refusal[]; notes: Note[] } {
  const refusals: Refusal[] = [];
  const invalid: Refusal[] = [];
  for (const file of files) {
    const extracted = extract(file);
    invalid.push(...refusalsOf(file, extracted.invalid));
    for (const a of extracted.annotations)
      refusals.push({
        file,
        function: qualifiedName(a.functionName, a.className, a.isStatic),
        property: a.propertyName,
        error,
      });
  }
  return { refusals: [...refusals, ...invalid], notes: echo(invalid) };
}

/** Extract and parse every formula once. A formula the parsers cannot read
 * is a compile error, so it aborts the run; a clamp-emptied interval parses
 * and stays for the engines to contain per annotation. */
function readFormulas(files: string[]): ParsedFile[] {
  return files.map((file) => {
    const { exports, classes, annotations } = extract(file);
    const parsed: ParsedAnnotation[] = annotations.map((raw) => {
      try {
        const { binders, body } = parsePrefix(raw.formula);
        return { raw, parsed: { binders, formula: parseBody(body) } };
      } catch (e) {
        if (e instanceof EmptyAfterClampError) return { raw };
        if (e instanceof LemmaError)
          throw new LemmaError(
            `${file}:${raw.line}: @ensures{${raw.propertyName}}: ${e.message}`,
            { cause: e },
          );
        throw e;
      }
    });
    return { file, exports, classes, annotations: parsed };
  });
}

/**
 * Resolve `patterns` (or discover the tsconfig's files), type check the
 * whole project under lakatos's required options with `cacheFile` as the
 * incremental build info, and type every formula's atoms. Throws LemmaError
 * when resolution comes up empty or a formula cannot be read.
 */
export function admit(patterns: string[], cacheFile: string): Admission {
  const notes: Note[] = [];
  const { files, source } = resolveFiles(patterns);
  if (source === "tsconfig.json")
    notes.push({
      level: "info",
      text: `no files given; discovered ${files.length} file(s) via tsconfig.json`,
    });
  const check = typecheckProject(process.cwd(), cacheFile);
  if (check.kind === "missing") {
    const refused = refuseFiles(files, NO_TSCONFIG);
    return {
      kind: "refused",
      refusals: refused.refusals,
      notes: [
        ...notes,
        ...refused.notes,
        {
          level: "info",
          text: `no tsconfig.json; reporting ${annotations(refused.refusals.length)} as InputError`,
        },
      ],
    };
  }
  if (check.kind === "failed") {
    const refused = refuseFiles(files, typecheckFailure(check.diagnostics));
    return {
      kind: "refused",
      refusals: refused.refusals,
      notes: [
        ...notes,
        ...check.diagnostics.map((d): Note => ({
          level: "error",
          text: formatTsDiagnostic(d),
        })),
        ...refused.notes,
        {
          level: "info",
          text: `the program does not type check under lakatos's required options; reporting ${annotations(refused.refusals.length)} as InputError`,
        },
      ],
    };
  }
  // A named file the program does not include was never checked: refuse it
  // alone, and admit the rest.
  const program = new Set(check.programFiles);
  const outside = files.filter((f) => !program.has(f));
  for (const f of outside)
    notes.push({ level: "error", text: outsideProgram(f) });
  const gate = outside.map((f) => refuseFiles([f], outsideProgram(f)));
  const checked = files.filter((f) => program.has(f));
  // Atoms are host code the gate never saw: type them before any engine does.
  const typed = typeFormulas(readFormulas(checked), check.checked);
  const typeErrors = typed.invalid.flatMap(({ file, invalid }) =>
    refusalsOf(file, invalid),
  );
  return {
    kind: "admitted",
    files: checked,
    refused: typed.refused,
    refusals: [...gate.flatMap((g) => g.refusals), ...typeErrors],
    notes: [...notes, ...gate.flatMap((g) => g.notes), ...echo(typeErrors)],
  };
}
