import * as path from "node:path";
import { admit, qualifiedName, refusalsOf } from "@lakatos/lemma";
import {
  identityOf,
  type AnnotationResult,
  type PropertyIdentity,
} from "@lakatos/core/envelope";
import { RUN_ROOT, TYPECHECK_CACHE } from "@lakatos/core/run-dir";
import {
  consoleIo,
  packageVersion,
  runTool,
  type Outcome,
  type Plan,
  type RunReport,
  type Spine,
  type ToolIo,
} from "@lakatos/core/runner";
import { writeEmissionArtifacts } from "./emission-artifacts.js";
import { joinProveVerdicts } from "./join.js";
import { findEngineRoot, type LeanRunResult, runEmission } from "./run.js";

export interface ProveOptions {
  /** Where notes and the envelope go; stderr and stdout when absent. */
  io?: ToolIo;
}

/**
 * Prove every `@ensures` annotation in the files `patterns` name, or in the
 * files tsconfig.json compiles when there are none, from the current
 * directory. Resolves to the envelope and the exit code the bin reports;
 * rejects with LemmaError on bad input and RunDirError on an unusable run
 * root. Needs a lakatos checkout with the Lean toolchain.
 */
export function prove(
  patterns: string[],
  options: ProveOptions = {},
): Promise<RunReport> {
  const io = options.io ?? consoleIo;
  return runTool(
    { name: "thales", version: packageVersion(import.meta.url) },
    (note) => admit(patterns, path.resolve(RUN_ROOT, TYPECHECK_CACHE), note),
    proveSpine(io),
    io,
  );
}

/** Containment, join, and health discipline over a Lean run result. */
function leanRunOutcome(
  result: LeanRunResult,
  plan: Plan,
  sourceOf: Map<string, string>,
  io: ToolIo,
): Outcome {
  if (result.kind === "interrupted")
    return { kind: "interrupted", signal: result.signal };
  if (result.kind === "no-project")
    return { kind: "unhealthy", messages: [result.message] };
  if (result.kind === "failed")
    return {
      kind: "unhealthy",
      messages: ["the Lean run failed before reporting verdicts"],
      raw: result.stdout + result.stderr,
    };
  for (const d of result.diagnostics) io.note(d);
  for (const f of result.failures)
    for (const m of f.messages) io.note(`error: ${m}`);

  // A contained per-artifact failure degrades only that file's
  // annotations; every healthy verdict still reaches the envelope.
  const failedSources = new Set(
    result.failures.map((f) => sourceOf.get(f.file)),
  );
  const failedResults: AnnotationResult[] = plan.identities
    .filter((i) => failedSources.has(i.file))
    .map((i) => ({
      ...identityOf(i),
      szs: "Error" as const,
      error:
        "the Lean run on this file's artifact failed before reporting its verdicts",
    }));
  const join = joinProveVerdicts(
    plan.identities.filter((i) => !failedSources.has(i.file)),
    result.verdicts,
    result.models,
  );
  if (join.kind === "mismatched")
    return { kind: "unhealthy", messages: join.messages };

  return {
    kind: "completed",
    annotations: [...join.annotations, ...failedResults],
    meta: {},
    degraded: result.failures.length > 0,
    refuted: join.annotations.some((a) => a.szs === "CounterSatisfiable"),
  };
}

/** The plain-Lean emission spine: the frontend classifies everything it
 * cannot map before emission, thales-emit renders the artifacts, and the
 * Lean-run discipline does the rest. */
function proveSpine(io: ToolIo): Spine {
  const sourceOf = new Map<string, string>();
  const jsonOf = new Map<string, string>();
  return {
    plan(files, runDir, refused) {
      const outRoot = path.join(runDir, "thales");
      const artifacts = writeEmissionArtifacts(files, outRoot, refused);
      const inputErrors = artifacts.flatMap((a) =>
        refusalsOf(a.sourceFile, a.invalid),
      );
      // Partition each file's annotations once, by object identity:
      // classified ones were settled by the frontend and are never
      // expected in the verdict join; the rest are the identities the
      // join must account for.
      const tried: PropertyIdentity[] = [];
      const classifiedResults: AnnotationResult[] = [];
      const proveFiles: string[] = [];
      for (const a of artifacts) {
        const classified = new Map(a.classified.map((c) => [c.annotation, c]));
        for (const r of a.annotations) {
          const identity = {
            file: a.sourceFile,
            function: qualifiedName(r.functionName, r.className, r.isStatic),
            property: r.propertyName,
          };
          const c = classified.get(r);
          if (c === undefined) tried.push(identity);
          // The envelope's field split: an engine failure explains
          // itself in `error`, everything else in `reason`.
          else if (c.szs === "Error")
            classifiedResults.push({
              ...identity,
              szs: c.szs,
              error: c.reason,
            });
          else
            classifiedResults.push({
              ...identity,
              szs: c.szs,
              ...(c.kind !== undefined ? { kind: c.kind } : {}),
              reason: c.reason,
            });
        }
        if (a.leanFile !== undefined) {
          sourceOf.set(a.leanFile, a.sourceFile);
          jsonOf.set(a.leanFile, a.jsonFile!);
          proveFiles.push(a.leanFile);
        }
      }
      const n = tried.length;
      return {
        identities: tried,
        untried: classifiedResults,
        inputErrors,
        notes: [
          {
            level: "info",
            text: `emitted ${n} annotation${n === 1 ? "" : "s"} across ${artifacts.length} file(s) into ${outRoot}/`,
          },
        ],
        degraded: classifiedResults.some((r) => r.szs === "Error"),
        outFiles: proveFiles,
        meta: {},
        emptyMeta: {},
        emptyExit: 0,
      };
    },

    run(plan) {
      const jobs = plan.outFiles.map((leanFile) => ({
        jsonFile: jsonOf.get(leanFile)!,
        leanFile,
      }));
      return leanRunOutcome(
        runEmission(jobs, findEngineRoot()),
        plan,
        sourceOf,
        io,
      );
    },
  };
}
