import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  identityOf,
  interruptedResults,
  UNSUPPORTED_RANGE_KIND,
  type AnnotationResult,
  type Envelope,
  type PlannedProperty,
  type PropertyIdentity,
} from "./envelope.js";
import { withInterruptGuard, type InterruptSignal } from "./interrupt.js";
import { claimRunDir } from "./run-dir.js";

/** The running tool: its name prefixes its own stderr notes, its version
 * goes into every envelope it emits. */
export interface Tool {
  name: string;
  version: string;
}

/** A stderr line. `error` prints as `error: <text>`, `info` as
 * `<tool>: <text>`. */
export interface Note {
  level: "error" | "info";
  text: string;
}

/** An annotation refused as bad input; the envelope reports it InputError. */
export interface InputRefusal extends PropertyIdentity {
  error: string;
}

/** The front end's verdict on a command line, before any engine runs.
 * `notes` are in stderr order and already cover the refusals that need
 * echoing. A refused admission stops the run at exit 2. */
export type Admission =
  | { kind: "refused"; refusals: InputRefusal[]; notes: Note[] }
  | {
      kind: "admitted";
      files: string[];
      /** Annotations the engine skips: already refused during admission. */
      refused: ReadonlySet<string>;
      refusals: InputRefusal[];
      notes: Note[];
    };

/** Envelope fields outside the per-annotation list. */
export type EnvelopeMeta = Omit<Envelope, "annotations">;

/** What one engine's codegen produced, normalized across engines. */
export interface Plan {
  /** Annotations the engine will attempt; the verdict join accounts for each. */
  identities: PlannedProperty[];
  /** Annotations already resolved at codegen time, in envelope form. */
  untried: AnnotationResult[];
  /** Extraction-level input errors; the runner echoes each to stderr. */
  inputErrors: InputRefusal[];
  /** Printed after the input errors, in order. */
  notes: Note[];
  /** The codegen itself failed on part of the run: exit 2 beside whatever
   * else ships. */
  degraded: boolean;
  /** Artifacts this invocation generated — the only ones the run may touch. */
  outFiles: string[];
  /** Envelope fields only this engine carries (refute's seed and count). */
  meta: Partial<EnvelopeMeta>;
  /** Envelope fields that hold only when there was nothing to run. */
  emptyMeta: Partial<EnvelopeMeta>;
  /** Exit code when there is nothing to run and no input errors. */
  emptyExit: number;
}

/** One engine's run, normalized. */
export type Outcome =
  | {
      /** The engine never reported: annotations were produced but not evaluated. */
      kind: "unhealthy";
      messages: string[];
    }
  | {
      /** A termination signal stopped the engine mid-run. */
      kind: "interrupted";
      signal: InterruptSignal;
    }
  | {
      kind: "completed";
      annotations: AnnotationResult[];
      meta: Partial<EnvelopeMeta>;
      /** The engine failed on part of the run: exit 2 beside the verdicts. */
      degraded: boolean;
      /** The engine refuted something: the documented exit 1. */
      refuted: boolean;
    };

export interface Spine {
  /** `runDir` is this invocation's artifact root; the engine joins its own
   * name onto it. `refused` keys the annotations admission already reported. */
  plan(files: string[], runDir: string, refused: ReadonlySet<string>): Plan;
  /** Absent for a command with no engine — its plan yields no artifacts. */
  run?(plan: Plan, runDir: string): Outcome;
}

/** Where a run's stderr notes and its one envelope go. */
export interface ToolIo {
  note(line: string): void;
  emit(envelope: Envelope): void;
}

/** The bins' streams: notes on stderr, the envelope as JSON on stdout. */
export const consoleIo: ToolIo = {
  note: (line) => console.error(line),
  emit: (envelope) => console.log(JSON.stringify(envelope, null, 2)),
};

export interface RunReport {
  code: number;
  envelope: Envelope;
}

/** The version in the nearest package.json above `moduleUrl`. A module runs
 * from src/ under vitest and from dist/ as a bin, so the depth varies. */
export function packageVersion(moduleUrl: string): string {
  let dir = path.dirname(fileURLToPath(moduleUrl));
  while (!existsSync(path.join(dir, "package.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("package.json not found");
    dir = parent;
  }
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
    .version as string;
}

function inputError(r: InputRefusal): AnnotationResult {
  return {
    file: r.file,
    function: r.function,
    property: r.property,
    szs: "InputError",
    error: r.error,
  };
}

const annotations = (n: number): string =>
  `${n} annotation${n === 1 ? "" : "s"}`;

/**
 * The pipeline every tool shares once its front end has admitted the input:
 * claim a run directory, plan, run under the interrupt guard, and turn the
 * outcome into one envelope and one exit code. Exit 2 for bad input, an
 * engine failure, or an interrupted run; else 1 when something was refuted.
 */
export async function runTool(
  tool: Tool,
  admit: () => Admission,
  spine: Spine,
  io: ToolIo = consoleIo,
): Promise<RunReport> {
  const say = (n: Note): void =>
    io.note(
      n.level === "error" ? `error: ${n.text}` : `${tool.name}: ${n.text}`,
    );
  const report = (envelope: Envelope, code: number): RunReport => {
    io.emit(envelope);
    return { code, envelope };
  };
  const base: EnvelopeMeta = {
    version: tool.version,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
  // Admission runs before claimRunDir, so a refused run leaves no empty
  // run directory and no engine sees unchecked input.
  const admission = admit();
  for (const n of admission.notes) say(n);
  if (admission.kind === "refused")
    return report(
      { ...base, annotations: admission.refusals.map(inputError) },
      2,
    );

  const runDir = claimRunDir(base.startedAt);
  const plan = spine.plan(admission.files, runDir, admission.refused);
  for (const r of plan.inputErrors) say({ level: "error", text: r.error });
  for (const n of plan.notes) say(n);
  const inputErrors = [...admission.refusals, ...plan.inputErrors].map(
    inputError,
  );
  // Every tool refuses a domain it cannot represent as written; this count
  // is the one place that says so.
  const unsupported = plan.untried.filter(
    (u) => u.kind === UNSUPPORTED_RANGE_KIND,
  ).length;
  if (unsupported > 0)
    say({
      level: "info",
      text: `${annotations(unsupported)} not tried (unsupported range)`,
    });
  const meta = { ...base, ...plan.meta };

  if (plan.outFiles.length === 0 || spine.run === undefined)
    return report(
      {
        ...meta,
        ...plan.emptyMeta,
        annotations: [...plan.untried, ...inputErrors],
      },
      inputErrors.length > 0 || plan.degraded ? 2 : plan.emptyExit,
    );

  // A run that stopped before evaluating what it planned: the run stats stay
  // out, since a run that did not finish knows no counts.
  const stopped = (entries: AnnotationResult[]): RunReport =>
    report(
      { ...meta, annotations: [...entries, ...plan.untried, ...inputErrors] },
      2,
    );
  const interruptedExit = (signal: InterruptSignal): RunReport => {
    say({
      level: "info",
      text: `interrupted by ${signal}; reporting ${annotations(plan.identities.length)} as User`,
    });
    return stopped(interruptedResults(plan.identities, signal));
  };
  const run = spine.run;
  // The guard spans the run and the report: a second Ctrl-C, landing while
  // the engine is still dying, must not cut the envelope short.
  return withInterruptGuard(async (interrupted) => {
    const outcome = run(plan, runDir);
    // The signal that reached this process decides, whatever the engine
    // made of its own copy.
    const observed = await interrupted();
    if (outcome.kind === "interrupted")
      return interruptedExit(observed ?? outcome.signal);
    if (observed !== undefined) return interruptedExit(observed);
    if (outcome.kind === "unhealthy") {
      for (const m of outcome.messages) say({ level: "error", text: m });
      return stopped(
        plan.identities.map((i) => ({
          ...identityOf(i),
          szs: "NotTried" as const,
        })),
      );
    }
    // A proof resting on an unvalidated model says so where a person sees it.
    for (const a of outcome.annotations)
      if (a.szs === "Theorem" && a.model?.status === "unvalidated")
        say({
          level: "info",
          text: `${a.file} ${a.function}/${a.property}: PROVED (model unvalidated: ${a.model.reason})`,
        });
    return report(
      {
        ...meta,
        ...outcome.meta,
        annotations: [...outcome.annotations, ...plan.untried, ...inputErrors],
      },
      // Bad input and engine failures outrank a refutation.
      inputErrors.length > 0 || plan.degraded || outcome.degraded
        ? 2
        : outcome.refuted
          ? 1
          : 0,
    );
  });
}
