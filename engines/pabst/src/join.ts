import {
  type Envelope,
  identityKey,
  identityOf,
  type AnnotationResult,
  type PlannedProperty,
  type RunMeta,
} from "@lakatos-ts/core/envelope";
import { szsForIssue } from "@lakatos-ts/core/szs";
import { parseIssue, type Issue } from "./contract.js";
import type { VitestJson } from "./vitest-json.js";

/** How each failed assertion reads back out of the run: a parsed payload
 * becomes an Issue; a failed assertion no message of which carries a
 * readable payload means the reporter never ran, and is returned as a
 * diagnostic line instead of a verdict. */
export interface CollectedIssues {
  issues: Issue[];
  unreadable: string[];
}

/** The payload is not always the first failure message vitest reports, so
 * each entry is searched. */
export function collectIssues(json: VitestJson): CollectedIssues {
  const issues: Issue[] = [];
  const unreadable: string[] = [];
  for (const file of json.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      if (a.status !== "failed") continue;
      const messages = a.failureMessages ?? [];
      const issue = messages.map((m) => parseIssue(m)).find((i) => i !== null);
      if (issue) {
        issues.push(issue);
        continue;
      }
      const head = messages.find((m) => m.trim() !== "")?.split("\n", 1)[0];
      unreadable.push(
        head === undefined
          ? "a failed test carries no failure message"
          : `a failed test carries no readable issue payload: ${head}`,
      );
    }
  }
  return { issues, unreadable };
}

export type RefuteJoin =
  | { kind: "joined"; annotations: AnnotationResult[] }
  | {
      /** The engine reported a failure the join cannot read: no verdict
       * can be trusted, so none ship. */
      kind: "unreadable";
      messages: string[];
    };

/**
 * Join the generated properties against the run's parsed issues: every
 * identity gets an entry — flagged ones carry the issue's kind and detail,
 * the rest ran without a counterexample. A pass over a planned enumeration
 * is the Theorem; a pass over a sampled domain is only a GaveUp. A failed
 * assertion whose payload cannot be read is not a GaveUp — the run is
 * returned unreadable and the caller contains it.
 */
export function joinRefuteVerdicts(
  identities: PlannedProperty[],
  json: VitestJson,
): RefuteJoin {
  const { issues, unreadable } = collectIssues(json);
  if (unreadable.length > 0)
    return { kind: "unreadable", messages: unreadable };
  const flagged = new Map(
    issues.map((i) => [
      identityKey({ file: i.file, function: i.function, property: i.property }),
      i,
    ]),
  );
  const annotations = identities.map((planned) => {
    const id = identityOf(planned);
    const issue = flagged.get(identityKey(id));
    if (!issue) {
      // A pass carries no message: only the plan says whether the whole
      // domain was walked.
      if (planned.cases === undefined) return { ...id, szs: "GaveUp" as const };
      return {
        ...id,
        szs: "Theorem" as const,
        kind: "enumerated" as const,
        cases: planned.cases,
      };
    }
    const result: AnnotationResult = {
      ...id,
      szs: szsForIssue(issue.kind),
      kind: issue.kind,
    };
    if (issue.counterexample !== undefined)
      result.counterexample = issue.counterexample;
    if (issue.error !== undefined) result.error = issue.error;
    if (issue.reason !== undefined) result.reason = issue.reason;
    return result;
  });
  return { kind: "joined", annotations };
}
/** The whole envelope for a completed, readable refutation run. Only tests
 * assemble envelopes this way; an unreadable run throws rather than
 * pretending to verdicts. */
export function buildEnvelope(
  meta: RunMeta,
  json: VitestJson,
  identities: PlannedProperty[],
): Envelope {
  const join = joinRefuteVerdicts(identities, json);
  if (join.kind === "unreadable") throw new Error(join.messages.join("\n"));
  return {
    version: meta.version,
    startedAt: meta.startedAt,
    cwd: meta.cwd,
    seed: meta.seed,
    generated: meta.generated,
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    annotations: join.annotations,
  };
}
