import {
  type AnnotationResult,
  identityKey,
  identityOf,
  modelFor,
  type PropertyIdentity,
} from "@lakatos-ts/core/envelope";
import { isProveStatus } from "@lakatos-ts/core/szs";
import type { LeanVerdict, ModelLine } from "./run.js";

/** One #thales_prove verdict line; run.ts, which parses the wire
 * format, owns the shape. */
export type ProveVerdict = LeanVerdict;

/** One #thales_validate model line, the same way. */
export type ProveModelLine = ModelLine;

export type ProveJoin =
  | { kind: "joined"; annotations: AnnotationResult[] }
  | { kind: "mismatched"; messages: string[] };

/** The Theorem reason (a run-internal kernel name) is dropped — what the
 * proof rests on travels as its axioms — and so is the CounterSatisfiable
 * one: its substance is the counterexample, which ships in the same
 * falsified shape the refutation engine uses. Error diagnostics travel in
 * `error` like every other engine failure. */
function verdictResult(
  p: PropertyIdentity,
  v: ProveVerdict,
  line: ModelLine | undefined,
): AnnotationResult {
  const id = identityOf(p);
  const szs = v.szs;
  const model = modelFor(szs, line, p.function);
  // Spread only where the status carries it, so the Error and NotTried
  // shapes stay exactly as bare as the schema says they are.
  const m = model === undefined ? {} : { model };
  if (szs === "Theorem") return { ...id, szs, axioms: v.axioms ?? [], ...m };
  if (szs === "CounterSatisfiable")
    return {
      ...id,
      szs,
      kind: "falsified",
      counterexample: v.counterexample,
      ...m,
    };
  if (szs === "Error") return { ...id, szs, error: v.reason };
  return { ...id, szs, reason: v.reason, ...m };
}

/**
 * Join the extracted identities against the prover's verdict lines. The
 * emitter writes exactly one #thales_prove per annotation it does not
 * classify itself, so a missing, duplicate, or surplus verdict means the
 * run cannot be trusted.
 */
export function joinProveVerdicts(
  identities: PropertyIdentity[],
  verdicts: ProveVerdict[],
  models: ProveModelLine[],
): ProveJoin {
  const messages: string[] = [];
  // A model line is per declaration, so one line serves every annotation
  // of its function. A second line for the same declaration is a channel
  // violation, as unhealthy as a duplicate verdict; a line for a function
  // no annotation names is not — the emitter states an obligation for
  // every entry-module declaration, annotated or not.
  const modelByKey = new Map<string, ProveModelLine>();
  for (const m of models) {
    const key = JSON.stringify([m.file, m.function]);
    if (modelByKey.has(key)) messages.push(`duplicate model line for ${key}`);
    modelByKey.set(key, m);
  }
  const byKey = new Map<string, ProveVerdict>();
  for (const v of verdicts) {
    const key = identityKey({
      file: v.identity[0],
      function: v.identity[1],
      property: v.identity[2],
    });
    if (byKey.has(key)) messages.push(`duplicate verdict for ${key}`);
    if (!isProveStatus(v.szs)) {
      messages.push(
        `verdict status ${JSON.stringify(v.szs)} for ${key} is not representable in the envelope`,
      );
    }
    // An empty counterexample object counts as none: the envelope schema
    // requires at least one binder/value pair on a falsified annotation.
    if (
      v.szs === "CounterSatisfiable" &&
      (v.counterexample === undefined ||
        Object.keys(v.counterexample).length === 0)
    ) {
      messages.push(
        `CounterSatisfiable verdict for ${key} carries no counterexample`,
      );
    }
    byKey.set(key, v);
  }
  const annotations: AnnotationResult[] = [];
  for (const id of identities) {
    const key = identityKey(id);
    const v = byKey.get(key);
    if (v === undefined) {
      messages.push(`no verdict for ${key}`);
      continue;
    }
    byKey.delete(key);
    annotations.push(
      verdictResult(
        id,
        v,
        modelByKey.get(JSON.stringify([id.file, id.function])),
      ),
    );
  }
  for (const key of byKey.keys()) {
    messages.push(`verdict for unknown annotation ${key}`);
  }
  if (messages.length > 0) return { kind: "mismatched", messages };
  return { kind: "joined", annotations };
}
