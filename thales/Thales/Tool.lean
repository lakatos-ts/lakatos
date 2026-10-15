import Thales.Engine
import Thales.Join
import Thales.RunDir

/-! The run: lemma's documents, admission, the run directory, the plan,
the engine under the interrupt guard, and one envelope and one exit code
out — `core/src/runner.ts`'s `runTool` over thales's spine.

Exit 2 for bad input, an engine failure, or an interrupted run; else 1
when something was refuted; else 0. -/

namespace Thales

open Lean Tarski

/-- The tool's version, as every envelope reports it. -/
def version : String := "0.1.1"

/-- Where a run's notes and its envelope go: stderr and stdout. -/
structure Io where
  note : String → IO Unit := IO.eprintln
  emit : Envelope → IO Unit := fun e => IO.println e.render
  /-- An engine's own output, byte for byte. -/
  raw : String → IO Unit := fun s => do (← IO.getStderr).putStr s

/-- The engine's run, settled. -/
private inductive Outcome where
  | unhealthy (messages : Array String) (raw : Option String)
  | interrupted (signal : String)
  | completed (annotations : Array AnnotationResult) (degraded refuted : Bool)

/-- Containment, join, and health over an engine run. -/
private def outcomeOf (run : EngineRun) (plan : Plan) (io : Io) : IO Outcome := do
  match run with
  | .noProject m => return .unhealthy #[m] none
  | .failed raw => return .unhealthy #["the Lean run failed before reporting verdicts"] (some raw)
  | .interrupted s => return .interrupted s
  | .completed verdicts models failures diagnostics =>
    diagnostics.forM io.note
    for f in failures do
      for m in f.messages do io.note s!"error: {m}"
    -- A contained per-artifact failure degrades only that file's
    -- annotations; every healthy verdict still reaches the envelope.
    let sourceOf : Std.HashMap String String :=
      plan.jobs.foldl (fun m j => m.insert j.leanFile.toString j.sourceFile) {}
    let failedSources := failures.filterMap (sourceOf.get? ·.file.toString)
    let failedResults := plan.identities.filter (failedSources.contains ·.file) |>.map fun i =>
      ({ identity := i, szs := .Error,
         error := some "the Lean run on this file's artifact failed before reporting its verdicts" } :
        AnnotationResult)
    match joinVerdicts (plan.identities.filter (!failedSources.contains ·.file)) verdicts models with
    | .mismatched ms => return .unhealthy ms none
    | .joined as =>
      return .completed (as ++ failedResults) (!failures.isEmpty)
        (as.any (·.szs == .CounterSatisfiable))

/-- Prove every `@ensures` in the files `patterns` name, or in the files
tsconfig.json compiles when there are none, from the current directory,
with the engine at `engineRoot`. Answers the exit code; the envelope, when
there is one, has gone to `io`. -/
def prove (patterns : Array String) (engineRoot : Option System.FilePath) (io : Io := {}) :
    IO UInt32 := do
  let say (n : Note) : IO Unit := io.note n.render
  let startedAt ← isoNow
  let cwd ← IO.currentDir
  let report (annotations : Array AnnotationResult) (code : UInt32) : IO UInt32 := do
    io.emit { version, startedAt, cwd := cwd.toString, annotations }
    return code
  let fail (msg : String) : IO UInt32 := do
    say (.error msg)
    return 2
  let bin ← match ← Lemma.resolve with
    | .ok b => pure b
    | .error msg => return ← fail msg
  let docs ← match ← Lemma.checkPatterns bin patterns typecheckCache.toString with
    | .ok ds => pure ds
    | .error msg => return ← fail msg
  -- Admission runs before the run directory is claimed, so a refused run
  -- leaves no empty directory and no engine sees unchecked input.
  let (docs, refusals) ← match ← admit docs patterns.isEmpty say with
    | .refused rs => return ← report (rs.map fun (i, e) => inputError i e) 2
    | .failed msg => return ← fail msg
    | .admitted ds rs => pure (ds, rs)
  let runDir ← match ← claimRunDir startedAt with
    | .ok d => pure d
    | .error msg => return ← fail msg
  let plan ← match ← planRun cwd docs runDir with
    | .ok p => pure p
    | .error msg => return ← fail msg
  plan.inputErrors.forM fun (_, e) => say (.error e)
  plan.notes.forM say
  let inputErrors := (refusals ++ plan.inputErrors).map fun (i, e) => inputError i e
  let unsupported := plan.untried.filter (·.kind == some unsupportedRangeKind) |>.size
  if unsupported > 0 then
    say (.info s!"{annotations unsupported} not tried (unsupported range)")
  if plan.jobs.isEmpty then
    return ← report (plan.untried ++ inputErrors)
      (if !inputErrors.isEmpty || plan.degraded then 2 else 0)
  -- A run that stopped before evaluating what it planned.
  let stopped (entries : Array AnnotationResult) : IO UInt32 :=
    report (entries ++ plan.untried ++ inputErrors) 2
  let interruptedExit (signal : String) : IO UInt32 := do
    say (.info s!"interrupted by {signal}; reporting {annotations plan.identities.size} as User")
    stopped (interruptedResults plan.identities signal)
  -- The guard spans the run and the report: a second Ctrl-C, landing
  -- while the engine is still dying, must not cut the envelope short.
  withInterruptGuard fun interrupted => do
    let run ← match engineRoot with
      | some root => runEngine root plan.jobs interrupted
      | none => pure (.noProject
          "the Lean proof engine is not part of this installation; run prove from a lakatos checkout")
    let outcome ← outcomeOf run plan io
    -- The signal that reached this process decides, whatever the engine
    -- made of its own copy.
    let observed ← interrupted
    match outcome, observed with
    | _, some s => interruptedExit s
    | .interrupted s, none => interruptedExit s
    | .unhealthy messages raw, none =>
      if let some r := raw then io.raw r
      messages.forM (say <| .error ·)
      stopped (plan.identities.map fun i => { identity := i, szs := .NotTried })
    | .completed as degraded refuted, none =>
      -- A proof resting on an unvalidated model says so where a person
      -- sees it.
      for a in as do
        if let (.Theorem, some (.unvalidated r)) := (a.szs, a.model) then
          say (.info s!"{a.identity.file} {a.identity.function}/{a.identity.property}: PROVED (model unvalidated: {r})")
      report (as ++ plan.untried ++ inputErrors)
        -- Bad input and engine failures outrank a refutation.
        (if !inputErrors.isEmpty || plan.degraded || degraded then 2 else if refuted then 1 else 0)

end Thales
