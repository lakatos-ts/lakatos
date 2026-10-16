import Std.Time
import Tarski.Lemma
import Thales.Version
import Thales.Admit
import Thales.RunDir
import Thales.Engine
import Thales.Join

/-! The pipeline: admission, run directory, plan, run, envelope, exit
code. The order of every note and every envelope entry is the contract,
the same order core's runner (`core/src/runner.ts`) gives pabst. -/

namespace Thales

open System (FilePath)

private def say (n : Note) : IO Unit :=
  IO.eprintln (if n.error then s!"error: {n.text}" else s!"thales: {n.text}")

/-- `Date.prototype.toISOString`'s form: UTC, milliseconds truncated, `Z`. -/
def nowIso : IO String := do
  let ts ← Std.Time.Timestamp.now
  return (Std.Time.DateTime.ofTimestamp ts .UTC).format "uuuu-MM-dd'T'HH:mm:ss.SSS'Z'"

private def report (e : Envelope) (code : UInt32) : IO UInt32 := do
  IO.println e.render
  return code

/-- One file that reaches Lean: its document and the artifact rendered from
its emission. -/
private structure Job where
  plan : FilePlan
  emission : Lean.Json
  jsonFile : FilePath
  leanFile : FilePath

/-- One file's failure; only its own annotations are affected. -/
private structure FileFailure where
  file : String
  messages : Array String

private inductive Outcome where
  | interrupted (signal : String)
  | unhealthy (messages : Array String) (raw : Option String)
  | completed (annotations : Array AnnotationResult) (degraded refuted : Bool)

private def nonBlank (xs : List String) : Array String :=
  (xs.filter (!·.trimAscii.isEmpty)).toArray

/-- Build once, render every artifact, then run the rendered ones: a
render or run failure is contained to its file, an interrupted child stops
the run there. -/
private unsafe def runEngine (root : Option FilePath) (jobs : Array Job)
    (tried : Array Identity) : IO Outcome := do
  let some root := root | return .unhealthy #[noEngineMessage] none
  let renderer ← match ← buildEngine root with
    | .error (.noProject m) => return .unhealthy #[m] none
    | .error (.interrupted s) => return .interrupted s
    | .error (.failed out err) =>
      return .unhealthy #["the Lean run failed before reporting verdicts"] (some (out ++ err))
    | .ok r => pure r
  let mut failures : Array FileFailure := #[]
  let mut rendered : Array Job := #[]
  for j in jobs do
    match ← renderArtifact renderer j.emission j.leanFile with
    | .error msg =>
      failures := failures.push
        ⟨j.plan.file, #[s!"rendering {j.jsonFile} failed before writing the artifact"] ++ nonBlank [msg]⟩
    | .ok () => rendered := rendered.push j
  let mut verdicts : Array Verdict := #[]
  let mut models : Array ModelLine := #[]
  let mut diagnostics : Array String := #[]
  for j in rendered do
    let run ← runArtifact root j.leanFile
    if let some sig := interruptedBy run then return .interrupted sig
    if run.status != some 0 || run.failedToStart.isSome || run.timedOut then
      let timedOut := if run.timedOut then ["killed after its budget ran out"] else []
      failures := failures.push ⟨j.plan.file,
        #[s!"the Lean run on {j.leanFile} failed before reporting its verdicts"] ++
          nonBlank ([run.stdout, run.stderr, run.failedToStart.getD ""] ++ timedOut)⟩
      continue
    let ch := parseChannel run.stdout
    diagnostics := diagnostics ++ ch.diagnostics
    if !ch.messages.isEmpty then
      failures := failures.push ⟨j.plan.file, ch.messages⟩
      continue
    verdicts := verdicts ++ ch.verdicts
    models := models ++ ch.models
  for d in diagnostics do IO.eprintln d
  for f in failures do
    for m in f.messages do IO.eprintln s!"error: {m}"
  let failed (i : Identity) : Bool := failures.any (·.file == i.file)
  let failedResults := (tried.filter failed).map fun i =>
    AnnotationResult.mk i (.error "the Lean run on this file's artifact failed before reporting its verdicts")
  match joinProveVerdicts (tried.filter (!failed ·)) verdicts models with
  | .mismatched ms => return .unhealthy ms none
  | .joined joined =>
    return .completed (joined ++ failedResults) (!failures.isEmpty) (joined.any (·.result.isRefuted))

private def obligationCount (emission : Lean.Json) : Nat :=
  match emission.getObjVal? "obligations" with
  | .ok (.arr xs) => xs.size
  | _ => 0

/-- Prove every annotation in the files `patterns` name, or in the files
tsconfig.json compiles when there are none; prints the notes and the
envelope and answers the exit code. -/
unsafe def prove (patterns : Array String) : IO UInt32 := do
  let startedAt ← nowIso
  let cwd ← IO.currentDir
  let base : Envelope := { version, startedAt, cwd := cwd.toString, annotations := #[] }
  let bin ← match ← Tarski.Lemma.resolve with
    | .error msg => IO.eprintln s!"error: {msg}"; return 2
    | .ok bin => pure bin
  let cache := (cwd / runRoot / typecheckCache).toString
  let docs ← match ← Tarski.Lemma.checkPatterns bin patterns cache with
    | .error msg => IO.eprintln s!"error: {msg}"; return 2
    | .ok docs => pure docs
  -- The run directory is claimed only after admission, so a refused run
  -- leaves none.
  let (files, gateRefusals, typingRefusals) ← match admit patterns.isEmpty docs with
    | .abort notes message =>
      notes.forM say
      IO.eprintln s!"error: {message}"
      return 2
    | .refused notes refusals =>
      notes.forM say
      return ← report { base with annotations := refusals } 2
    | .admitted notes files gate typing =>
      notes.forM say
      pure (files, gate, typing)
  let runDir ← try claimRunDir startedAt catch
    | .userError m => IO.eprintln s!"error: {m}"; return 2
    | e => throw e
  let outRoot := runDir / "thales"
  let mut jobs : Array Job := #[]
  for f in files do
    -- A file with no annotations to try or classify writes nothing.
    if f.tried.isEmpty && f.classified.isEmpty then continue
    let mirror (suffix : String) : IO FilePath := match mirrorPath cwd f.file outRoot suffix with
      | .error m => throw (IO.userError m)
      | .ok p => pure p
    let jsonFile ← try mirror ".json" catch
      | .userError m => IO.eprintln s!"error: {m}"; return 2
      | e => throw e
    if let some p := jsonFile.parent then IO.FS.createDirAll p
    IO.FS.writeFile jsonFile f.document.compress
    if let some emission := f.emission then
      if obligationCount emission > 0 then
        jobs := jobs.push ⟨f, emission, jsonFile, ← mirror ".lean"⟩
  let extraction := files.flatMap (·.extractionRefusals)
  for r in extraction do
    if let .inputError e := r.result then say ⟨true, e⟩
  let tried := files.flatMap (·.tried)
  let classified := files.flatMap (·.classified)
  let inputErrors := gateRefusals ++ typingRefusals ++ extraction
  say ⟨false, s!"emitted {pluralAnnotations tried.size} across {files.size} file(s) into {outRoot}/"⟩
  let unsupported := classified.filter fun c => match c.result with
    | .classified _ (some "unsupported-range") _ => true
    | _ => false
  if unsupported.size > 0 then
    say ⟨false, s!"{pluralAnnotations unsupported.size} not tried (unsupported range)"⟩
  let planDegraded := classified.any fun c => match c.result with | .error _ => true | _ => false
  if jobs.isEmpty then
    return ← report { base with annotations := classified ++ inputErrors }
      (if !inputErrors.isEmpty || planDegraded then 2 else 0)
  -- A run that stopped before evaluating what it planned.
  let stopped (entries : Array AnnotationResult) : IO UInt32 :=
    report { base with annotations := entries ++ classified ++ inputErrors } 2
  match ← runEngine (← engineRoot) jobs tried with
  | .interrupted sig =>
    say ⟨false, s!"interrupted by {sig}; reporting {pluralAnnotations tried.size} as User"⟩
    stopped (interruptedResults tried sig)
  | .unhealthy messages raw =>
    if let some r := raw then IO.eprint r
    for m in messages do say ⟨true, m⟩
    stopped (tried.map (⟨·, .notTried⟩))
  | .completed annotations degraded refuted =>
    -- A proof resting on an unvalidated model says so where a person sees it.
    for a in annotations do
      if let .theorem _ (.unvalidated reason) := a.result then
        say ⟨false, s!"{a.identity.file} {a.identity.function}/{a.identity.property}: PROVED (model unvalidated: {reason})"⟩
    report { base with annotations := annotations ++ classified ++ inputErrors }
      (if !inputErrors.isEmpty || planDegraded || degraded then 2 else if refuted then 1 else 0)

/-- `thales run-artifact <file.lean>`: one artifact under the prove run's
argv, overrides, and budget, and its parsed channel as JSON. -/
def runArtifactCommand (file : String) : IO UInt32 := do
  let some root ← engineRoot | do IO.eprintln s!"error: {noEngineMessage}"; return 2
  let r ← runArtifact root file
  let ch := parseChannel r.stdout
  let strs (xs : Array String) : Lean.Json := .arr (xs.map .str)
  let verdict (v : Verdict) : Lean.Json := Lean.Json.mkObj <|
    [("identity", Lean.Json.arr #[.str v.identity.file, .str v.identity.function, .str v.identity.property]),
     ("szs", Lean.Json.str v.szs.toString), ("reason", Lean.Json.str v.reason)] ++
    (v.counterexample.map fun c => [("counterexample", c)]).getD [] ++
    (v.axioms.map fun a => [("axioms", strs a)]).getD []
  let model (m : ModelLine) : Lean.Json := Lean.Json.mkObj <|
    [("file", Lean.Json.str m.file), ("function", Lean.Json.str m.function),
     ("status", Lean.Json.str (if m.validated then "validated" else "unvalidated"))] ++
    (m.reason.map fun r => [("reason", Lean.Json.str r)]).getD []
  IO.println (Lean.Json.mkObj
    [("status", match r.status with | some s => Lean.Json.num s.toNat | none => Lean.Json.null),
     ("timedOut", r.timedOut), ("stderr", r.stderr),
     ("verdicts", .arr (ch.verdicts.map verdict)), ("models", .arr (ch.models.map model)),
     ("diagnostics", strs ch.diagnostics), ("messages", strs ch.messages)]).pretty
  return 0

end Thales
