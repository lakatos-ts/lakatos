import type { IssueKind, SzsStatus } from "./szs.js";

/** Identity of one scraped annotation: where it lives and what it claims. */
export interface PropertyIdentity {
  file: string;
  function: string;
  property: string;
}

/** The one kind outside pabst's Issue kinds: a NotTried whose range only
 * fits the prover's domain after the safe-integer clamp. The schema's
 * branch is pinned to this spelling by test; thales's own literal is
 * pinned by the type union. */
export const UNSUPPORTED_RANGE_KIND = "unsupported-range" as const;

/** D8's field: what the prover established about its model of the
 * annotated declaration. Nested under its own key so `reason` never
 * collides with the verdict's own, and `reason` is present exactly when
 * the model is unvalidated. */
export type ModelField =
  { status: "validated" } | { status: "unvalidated"; reason: string };

/** The statuses that carry the model field. A prover's Theorem must have
 * one; the other four carry it when the prover reached them. Every other
 * status — the prover's Error and NotTried, and every refuter result —
 * leaves it off, and the envelope schema makes it a violation there. */
export const MODEL_CARRIERS: ReadonlySet<SzsStatus> = new Set<SzsStatus>([
  "Theorem",
  "GaveUp",
  "Timeout",
  "CounterSatisfiable",
  "Inappropriate",
]);

/** The reason a declaration the artifact printed no model line for
 * carries: a class member (until the emitter states their obligations),
 * or an emitter that forgot one. Nothing was proved either way, so the
 * model is unvalidated and says so. */
export function unstatedModelReason(fn: string): string {
  return `no correspondence obligation was stated for '${fn}'`;
}

/** The model field one annotation gets: undefined for a status that does
 * not carry it, the line's own account where there is a line, and the
 * unstated reason where there is none. One function, so the prover's join and
 * the envelope store read the field off the same rule. */
export function modelFor(
  szs: SzsStatus,
  line: ModelField | undefined,
  fn: string,
): ModelField | undefined {
  if (!MODEL_CARRIERS.has(szs)) return undefined;
  if (line === undefined)
    return { status: "unvalidated", reason: unstatedModelReason(fn) };
  return line.status === "validated"
    ? { status: "validated" }
    : { status: "unvalidated", reason: line.reason };
}

/** One annotation's outcome in a lakatos run. Beyond the refutation
 * kinds, `unsupported-range` marks a NotTried whose range only fits the
 * prover's domain after the safe-integer clamp, and `enumerated` a
 * Theorem the refuter earned by walking the whole domain. */
export interface AnnotationResult extends PropertyIdentity {
  szs: SzsStatus;
  kind?: IssueKind | typeof UNSUPPORTED_RANGE_KIND | "enumerated";
  counterexample?: Record<string, unknown>;
  error?: string;
  /** Prove pipeline: the construct outside the mappable subset
   * (Inappropriate), or why the prover stopped (GaveUp, NotTried).
   * Refute pipeline: how far a budget-expired enumeration got (Timeout). */
  reason?: string;
  /** Theorem from the prover only: the non-standard axioms the proof
   * depends on. Empty for a kernel-checked proof. */
  axioms?: string[];
  /** Theorem from the refuter only: how many tuples it evaluated. */
  cases?: number;
  /** Prover annotations only (D8): whether the declaration's model was
   * proved equal to the evaluator's run of its own syntax tree, and why
   * not. Required on a proven Theorem; carried on GaveUp, Timeout,
   * CounterSatisfiable, and Inappropriate from the prover; never on a
   * refuter result, an Error, or a NotTried. */
  model?: ModelField;
}

/** What codegen planned for one annotation: its identity, plus, when the
 * refuter walks the whole domain, the tuple count the join will report. */
export interface PlannedProperty extends PropertyIdentity {
  cases?: number;
}

/** The identity alone. Planning detail must never reach the envelope by
 * spread: every result shape but the enumerated Theorem rejects it. */
export function identityOf(p: PropertyIdentity): PropertyIdentity {
  return { file: p.file, function: p.function, property: p.property };
}

/** Run metadata the refute command captures before running tests. */
export interface RunMeta {
  version: string;
  startedAt: string;
  cwd: string;
  seed: number;
  generated: number;
}

/** The full report of one lakatos run. Stub commands omit the run stats. */
export interface Envelope {
  version: string;
  startedAt: string;
  cwd: string;
  seed?: number;
  generated?: number;
  passed?: number;
  failed?: number;
  annotations: AnnotationResult[];
}

export function identityKey(i: PropertyIdentity): string {
  return JSON.stringify([i.file, i.function, i.property]);
}

/** Every annotation an interrupted run never finished evaluating, in
 * envelope form: processing stopped at the user's request, and the
 * reason names the signal that asked. Annotations already resolved
 * before the engine ran keep the status they earned. */
export function interruptedResults(
  identities: PlannedProperty[],
  signal: string,
): AnnotationResult[] {
  return identities.map((p) => ({
    ...identityOf(p),
    szs: "User" as const,
    reason: `the run was interrupted (${signal})`,
  }));
}
