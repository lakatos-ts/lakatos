import Thales.Plan
import Thales.Process
import Thales.Verdicts
import ThalesEmit.Json
import ThalesEmit.Artifact

/-! The engine run: build, render each job's artifact, run each artifact.

`lake build` first, so the libraries an artifact imports are compiled for
the pinned toolchain (a cached build is a fast no-op). Each job's
emission is rendered into its `.lean` artifact in this process, and each
artifact runs under `lake env lean` within its budget. Only a build
failure or a missing engine aborts the run; a render that fails, or an
artifact that hangs, crashes, or breaks the channel's contract, fails
that file's annotations alone. A termination signal stops the run where
it lands: nothing after it is started. -/

namespace Thales

open Lean

/-- One artifact whose render or Lean run failed or broke the contract;
only its own annotations are affected. -/
structure FileFailure where
  /-- The artifact's path. -/
  file : System.FilePath
  messages : Array String

inductive EngineRun where
  | completed (verdicts : Array Verdict) (models : Array ModelLine)
      (failures : Array FileFailure) (diagnostics : Array String)
  /-- This installation has no engine to run. -/
  | noProject (message : String)
  /-- The build failed; its output is passed through as is. -/
  | failed (raw : String)
  | interrupted (signal : String)

def buildTimeoutMs : Nat := 600000
def leanTimeoutMs : Nat := 300000

/-- What one correspondence proof may add to an artifact's wall clock: a
proof partially evaluates the declaration's whole realm, so a file with
many validated declarations is not killed for being large. -/
def validateTimeoutMs : Nat := 120000

/-- The lake package this executable belongs to: the nearest directory
above it holding a `lakefile.lean`, itself or under `thales/`. -/
def findEngineRoot (from_ : System.FilePath) : IO (Option System.FilePath) := do
  let mut dir := from_
  for _ in [0:64] do
    for c in [dir, dir / "thales"] do
      if ← (c / "lakefile.lean").pathExists then return some c
    match dir.parent with
    | some p => if p == dir then return none else dir := p
    | none => return none
  return none

/-- A positive decimal budget from `name`; zero and anything unreadable
are ignored, since Lean reads a zero heartbeat budget as unlimited. -/
def budgetOf (name : String) : IO (Option Nat) := do
  match (← IO.getEnv name).bind String.toNat? with
  | some n => return if n > 0 then some n else none
  | none => return none

/-- The heartbeat overrides the artifact runs take from the environment:
the e2e suites shrink them to exercise Timeout and the model budget. -/
def heartbeatArgs : IO (Array String) := do
  let mut args := #[]
  if let some n ← budgetOf "LAKATOS_PROVE_HEARTBEATS" then
    args := args.push s!"-Dweak.thales.heartbeats={n}"
  if let some n ← budgetOf "LAKATOS_PROVE_VALIDATE_HEARTBEATS" then
    args := args.push s!"-Dweak.thales.validateHeartbeats={n}"
  return args

/-- How many correspondence proofs an artifact asks for; one the tool
cannot read asks for none, and its own run reports it missing. -/
def validateCount (file : System.FilePath) : IO Nat := do
  try
    return ((← IO.FS.readFile file).splitOn "\n").countP (·.startsWith "#thales_validate ")
  catch _ => return 0

private def nonBlank (xs : List String) : Array String :=
  (xs.filter fun s => !s.all Char.isWhitespace).toArray

/-- One `lake` step in `root`; `none` means it went through. -/
private def lakeStep (root : System.FilePath) (args : Array String) (timeoutMs : Nat) :
    IO (Except EngineRun Ran) := do
  match ← runWithin "lake" args root timeoutMs with
  | .error (.notFound _) =>
    return .error (.noProject
      "lake was not found on PATH; install the Lean toolchain via elan (https://leanprover-community.github.io/get_started/) and re-run")
  | .error e => return .error (.failed s!"{e.message}\n")
  | .ok r =>
    if r.timedOut then
      return .error (.failed s!"{r.stdout}{r.stderr}lake {" ".intercalate args.toList} timed out after {timeoutMs / 1000} s\n")
    if r.exitCode != 0 then return .error (.failed (r.stdout ++ r.stderr))
    return .ok r

/-- Render one job's artifact in `env`: the emission its document
carries, through `ThalesEmit`'s renderer. -/
def renderJob (env : Environment) (job : Job) : IO (Except String Unit) := do
  match ThalesEmit.decodeDocument job.document with
  | .error msg => return .error msg
  | .ok emission =>
    try
      let ctx : Core.Context := { fileName := "<thales>", fileMap := default }
      let (out, _) ← (ThalesEmit.renderEmission emission).toIO ctx { env }
      if let some dir := job.leanFile.parent then IO.FS.createDirAll dir
      IO.FS.writeFile job.leanFile out
      return .ok ()
    catch e => return .error (toString e)

/-- The toolchain the engine's lake runs under, read from `lake env`: the
`lean` binary, its sysroot, and the search path to the package's oleans.
The artifacts run on that `lean` directly, so a budget's kill reaches
`lean` itself and not a `lake` above it, and the renderer imports from
the same oleans under the same sysroot. -/
structure Toolchain where
  lean : String
  sysroot : System.FilePath
  leanPath : String

def readToolchain (lakeEnv : String) : Option Toolchain := do
  let vars := lakeEnv.splitOn "\n" |>.filterMap fun line =>
    match line.splitOn "=" with
    | k :: v => some (k, "=".intercalate v)
    | [] => none
  let get (k : String) := vars.lookup k
  return { lean := ← get "LEAN", sysroot := ← get "LEAN_SYSROOT", leanPath := ← get "LEAN_PATH" }

/-- Every job's emission rendered into its artifact under `toolchain`;
a job whose render fails is a failure of its own file, and a renderer
that cannot be loaded fails them all. -/
def renderJobs (toolchain : Toolchain) (jobs : Array Job) (interrupted : IO (Option String)) :
    IO (Except String (Array System.FilePath × Array FileFailure)) := do
  let env ←
    try
      initSearchPath toolchain.sysroot (System.SearchPath.parse toolchain.leanPath)
      importModules #[{ module := `ThalesDsl }, { module := `ThalesEmit }] {}
        (trustLevel := 0) (loadExts := true)
    catch e =>
      let msg := s!"the renderer could not be loaded: {e}"
      return .ok (#[], jobs.map fun j => { file := j.leanFile, messages := #[msg] })
  let mut failures : Array FileFailure := #[]
  let mut rendered : Array System.FilePath := #[]
  for job in jobs do
    if let some s ← interrupted then return .error s
    match ← renderJob env job with
    | .error msg =>
      failures := failures.push
        { file := job.leanFile
          messages := #[s!"rendering {job.jsonFile} failed before the artifact was written", msg] }
    | .ok () => rendered := rendered.push job.leanFile
  return .ok (rendered, failures)

/-- Build, render, and run `jobs` from the engine at `root`. `interrupted`
answers whether a termination signal has reached the tool. -/
def runEngine (root : System.FilePath) (jobs : Array Job)
    (interrupted : IO (Option String)) : IO EngineRun := do
  let stopped : IO (Option EngineRun) := do
    return (← interrupted).map .interrupted
  match ← lakeStep root #["build"] buildTimeoutMs with
  | .error r => return (← stopped).getD r
  | .ok _ => pure ()
  if let some r ← stopped then return r
  let toolchain ← match ← lakeStep root #["env", "env"] buildTimeoutMs with
    | .error r => return (← stopped).getD r
    | .ok r => match readToolchain r.stdout with
      | some t => pure t
      | none => return .failed s!"lake env did not name LEAN, LEAN_SYSROOT, and LEAN_PATH:\n{r.stdout}"
  let (rendered, renderFailures) ← match ← renderJobs toolchain jobs interrupted with
    | .error s => return .interrupted s
    | .ok r => pure r
  let mut failures := renderFailures
  let mut verdicts := #[]
  let mut models := #[]
  let mut diagnostics := #[]
  let args ← heartbeatArgs
  let cwd ← IO.currentDir
  for file in rendered do
    if let some r ← stopped then return r
    let abs := if file.isAbsolute then file else cwd / file
    let budget := leanTimeoutMs + (← validateCount file) * validateTimeoutMs
    let ran ← runWithin toolchain.lean (args.push abs.toString) root budget
      #[("LEAN_PATH", some toolchain.leanPath), ("LEAN_SYSROOT", some toolchain.sysroot.toString)]
    -- A child that died of a termination signal most likely took the
    -- tool's own copy with it: give that copy time to be recorded.
    if let .ok r := ran then
      if [129, 130, 143].contains r.exitCode then IO.sleep 450
    -- The signal that killed this artifact killed the run: stop here
    -- rather than starting artifacts nobody is waiting for any more.
    if let some r ← stopped then return r
    match ran with
    | .error e =>
      failures := failures.push
        { file, messages := #[s!"the Lean run on {file} failed before reporting its verdicts", e.message] }
    | .ok r =>
      if r.timedOut || r.exitCode != 0 then
        let timeout := if r.timedOut then [s!"the Lean run on {file} timed out after {budget / 1000} s"] else []
        failures := failures.push
          { file, messages := #[s!"the Lean run on {file} failed before reporting its verdicts"]
              ++ nonBlank ([r.stdout, r.stderr] ++ timeout) }
        continue
      let c := parseChannel r.stdout
      diagnostics := diagnostics ++ c.diagnostics
      if !c.messages.isEmpty then
        failures := failures.push { file, messages := c.messages }
        continue
      verdicts := verdicts ++ c.verdicts
      models := models ++ c.models
  return .completed verdicts models failures diagnostics

end Thales
