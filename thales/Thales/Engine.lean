import Lean
import ThalesEmit.Json
import ThalesEmit.Artifact
-- `buildEngine` imports this module at runtime; importing it makes Lake build it.
import ThalesEmit

/-! The engine side: `lake build`, the artifact renderer in process, and
`lake env lean` on one artifact under the containment budget. -/

namespace Thales

open System (FilePath)

structure Spawned where
  /-- The exit code (a signaled death reads as 128 plus the signal), or
  none when thales killed the child at the deadline. -/
  status : Option UInt32
  stdout : String
  stderr : String
  /-- Killed by thales at the deadline. -/
  timedOut : Bool := false
  failedToStart : Option String := none
deriving Repr

/-- Every live descendant of `pid`. -/
private partial def descendants (pid : UInt32) : IO (Array String) := do
  let out ← try IO.Process.output { cmd := "pgrep", args := #["-P", toString pid] }
    catch _ => return #[]
  let kids := (out.stdout.splitOn "\n").filterMap (·.trimAscii.toString.toNat?) |>.toArray
  kids.foldlM (init := #[]) fun acc k => return acc.push (toString k) ++ (← descendants k.toUInt32)

/-- Those of `pids` still in the process table. -/
private def alive (pids : Array String) : IO (Array String) := do
  if pids.isEmpty then return #[]
  let out ← try IO.Process.output { cmd := "ps", args := #["-o", "pid=", "-p", ",".intercalate pids.toList] }
    catch _ => return #[]
  return (out.stdout.splitOn "\n").filterMap (fun l =>
    let t := l.trimAscii.toString
    if t.isEmpty then none else some t) |>.toArray

private def signal (sig : String) (pids : Array String) : IO Unit := do
  unless pids.isEmpty do
    let _ ← try IO.Process.output { cmd := "kill", args := #[s!"-{sig}"] ++ pids }
      catch _ => pure { exitCode := 1, stdout := "", stderr := "" }

/-- How long the descendants get to exit on SIGTERM before SIGKILL. -/
def killGraceMs : Nat := 1500

/-- Spawn with both streams piped, drained on their own tasks so neither
pipe fills, and polled against the deadline. -/
def runWithTimeout (cmd : String) (args : Array String) (cwd : Option FilePath) (budgetMs : Nat) :
    IO Spawned := do
  let child ←
    try
      IO.Process.spawn { cmd, args, cwd, stdin := .null, stdout := .piped, stderr := .piped }
    catch e =>
      return { status := none, stdout := "", stderr := "", failedToStart := some (toString e) }
  let outTask ← IO.asTask child.stdout.readToEnd .dedicated
  let errTask ← IO.asTask child.stderr.readToEnd .dedicated
  let deadline := (← IO.monoMsNow) + budgetMs
  let mut status : Option UInt32 := none
  let mut timedOut := false
  repeat
    if let some s ← child.tryWait then
      status := some s
      break
    if (← IO.monoMsNow) ≥ deadline then
      -- `lake env` spawns lean rather than exec'ing it: an orphaned
      -- grandchild would keep running and hold the pipes open.
      let tree ← descendants child.pid
      signal "TERM" tree
      child.kill
      let _ ← child.wait
      -- One that ignores SIGTERM would hold the pipes, and the drain, open.
      let graceEnd := (← IO.monoMsNow) + killGraceMs
      let mut left ← alive tree
      repeat
        if left.isEmpty || (← IO.monoMsNow) ≥ graceEnd then break
        IO.sleep 50
        left ← alive left
      unless left.isEmpty do
        signal "KILL" (← left.foldlM (init := left) fun acc p =>
          return acc ++ (← descendants p.toNat!.toUInt32))
      timedOut := true
      break
    IO.sleep 20
  let stdout ← IO.ofExcept outTask.get
  let stderr ← IO.ofExcept errTask.get
  -- Lean's spawn forks before exec, so a missing command is the forked
  -- child's own exit 255 with this line, not a thrown error.
  let noExec := s!"could not execute external process '{cmd}'\n"
  if status == some 255 && stdout.isEmpty && stderr == noExec then
    return { status, stdout, stderr, failedToStart := some stderr.trimAsciiEnd.toString }
  return { status, stdout, stderr, timedOut }

/-- A child that died of a termination signal, read off the exit code a
signaled child reports. A child thales killed at the deadline is not one. -/
def interruptedBy (r : Spawned) : Option String :=
  if r.timedOut || r.failedToStart.isSome then none
  else match r.status with
    | some 130 => some "SIGINT"
    | some 143 => some "SIGTERM"
    | some 129 => some "SIGHUP"
    | _ => none

def buildTimeoutMs : Nat := 600000
def leanTimeoutMs : Nat := 300000
/-- What one correspondence proof may add to an artifact's wall clock. -/
def validateTimeoutMs : Nat := 120000

private def budget? : Option String → Option String
  | some s => if !s.isEmpty && s.all Char.isDigit && s.toNat! > 0 then some s else none
  | none => none

/-- The heartbeat overrides; zero is not a budget (Lean reads it as
unlimited) and is ignored like any other unusable value. -/
def heartbeatArgs (prove validate : Option String) : Array String :=
  (budget? prove).toArray.map (s!"-Dweak.thales.heartbeats={·}") ++
  (budget? validate).toArray.map (s!"-Dweak.thales.validateHeartbeats={·}")

/-- How many correspondence proofs an artifact asks for. -/
def validateCount (artifactText : String) : Nat :=
  (artifactText.splitOn "\n").countP (·.startsWith "#thales_validate ")

/-- The lake package this binary was built in: `<root>/.lake/build/bin/thales`. -/
def engineRoot : IO (Option FilePath) := do
  let some root := (← IO.appPath).parent >>= (·.parent) >>= (·.parent) >>= (·.parent)
    | return none
  return if ← (root / "lakefile.lean").pathExists then some root else none

/-- What a run reports when `engineRoot` finds no lake package. -/
def noEngineMessage : String :=
  "the Lean proof engine is not part of this installation; run prove from a lakatos checkout"

inductive EngineFailure where
  | noProject (message : String)
  | interrupted (signal : String)
  | failed (stdout stderr : String)
deriving Repr

structure Renderer where
  env : Lean.Environment

private def lakeMissing : String :=
  "lake was not found on PATH; install the Lean toolchain via elan (https://leanprover-community.github.io/get_started/) and re-run"

/-- One `lake` step under the no-project / interrupt / failure discipline. -/
private def lakeStep (root : FilePath) (args : Array String) : IO (Except EngineFailure String) := do
  let r ← runWithTimeout "lake" args (some root) buildTimeoutMs
  if r.failedToStart.isSome then return .error (.noProject lakeMissing)
  if let some sig := interruptedBy r then return .error (.interrupted sig)
  unless r.status == some 0 do
    let timeout := if r.timedOut then s!"lake {" ".intercalate args.toList} timed out\n" else ""
    return .error (.failed r.stdout (r.stderr ++ timeout))
  return .ok r.stdout

/-- `lake build` (the artifacts import `ThalesDsl`; a cached build is a
fast no-op), then the environment the renderer pretty-prints against,
on the toolchain and search path `lake env` reports. -/
unsafe def buildEngine (root : FilePath) : IO (Except EngineFailure Renderer) := do
  match ← lakeStep root #["build"] with
  | .error f => return .error f
  | .ok _ => pure ()
  let vars ← match ← lakeStep root #["env"] with
    | .error f => return .error f
    | .ok out => pure out
  let var (name : String) : Option String :=
    (vars.splitOn "\n").findSome? (·.dropPrefix? s!"{name}=" |>.map (·.toString))
  let sysroot ← match var "LEAN_SYSROOT" with
    | some s => pure (FilePath.mk s)
    | none => Lean.findSysroot
  Lean.initSearchPath sysroot (System.SearchPath.parse ((var "LEAN_PATH").getD ""))
  -- Extension state, the parser and printer tables among it, is loaded
  -- only on demand, and loading it runs the imported initializers.
  Lean.enableInitializersExecution
  let env ← Lean.importModules #[{ module := `ThalesDsl }, { module := `ThalesEmit }] {}
    (trustLevel := 0) (loadExts := true)
  return .ok { env }

/-- One emission to one artifact, written only once it rendered whole. -/
def renderArtifact (r : Renderer) (emission : Lean.Json) (out : FilePath) : IO (Except String Unit) := do
  match ThalesEmit.decodeEmission emission with
  | .error msg => return .error msg
  | .ok e =>
    try
      let ctx : Lean.Core.Context := { fileName := "<thales>", fileMap := default }
      let (text, _) ← (ThalesEmit.renderEmission e).toIO ctx { env := r.env }
      if let some p := out.parent then IO.FS.createDirAll p
      IO.FS.writeFile out text
      return .ok ()
    catch ex => return .error (toString ex)

/-- `lake env lean` on one artifact under the containment budget, with the
heartbeat overrides from the environment. -/
def runArtifact (root : FilePath) (file : FilePath) : IO Spawned := do
  let text ← try IO.FS.readFile file catch _ => pure ""
  let cwd ← IO.currentDir
  let abs := if file.isAbsolute then file else cwd / file
  let args := #["env", "lean"] ++
    heartbeatArgs (← IO.getEnv "LAKATOS_PROVE_HEARTBEATS")
      (← IO.getEnv "LAKATOS_PROVE_VALIDATE_HEARTBEATS") ++
    #[abs.normalize.toString]
  runWithTimeout "lake" args (some root) (leanTimeoutMs + validateCount text * validateTimeoutMs)

end Thales
