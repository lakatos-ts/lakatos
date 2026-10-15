import Std.Internal.UV.Signal
import Std.Time

/-! Child processes, the clock, and termination signals: what the tool
needs from the operating system. -/

namespace Thales

/-- One child's run, as the tool reads it. -/
structure Ran where
  /-- The exit code; a child killed by a signal reports 128 plus it. -/
  exitCode : UInt32
  stdout : String
  stderr : String
  /-- The child outlived its budget and was killed. -/
  timedOut : Bool := false
  deriving Inhabited

/-- Why a child could not be had at all. -/
inductive SpawnError where
  /-- The command is not on PATH. -/
  | notFound (message : String)
  | other (message : String)

def SpawnError.message : SpawnError → String
  | .notFound m | .other m => m

/-- Run `cmd` to completion with its output captured, killing it once
`timeoutMs` has passed. A spawn that cannot start is an answer, never an
exception. -/
def runWithin (cmd : String) (args : Array String) (cwd : System.FilePath)
    (timeoutMs : Nat) (env : Array (String × Option String) := #[]) :
    IO (Except SpawnError Ran) := do
  let child ←
    try
      IO.Process.spawn
        { cmd, args, cwd := some cwd, env, stdin := .null, stdout := .piped, stderr := .piped }
    catch
      | e@(.noFileOrDirectory ..) => return .error (.notFound (toString e))
      | e => return .error (.other (toString e))
  -- Both streams drain while the child runs, so a full pipe never stalls it.
  let out ← IO.asTask child.stdout.readToEnd (prio := .dedicated)
  let err ← IO.asTask child.stderr.readToEnd (prio := .dedicated)
  let exit ← IO.asTask child.wait (prio := .dedicated)
  let deadline := (← IO.monoMsNow) + timeoutMs
  let mut timedOut := false
  while !(← IO.hasFinished exit) do
    if (← IO.monoMsNow) ≥ deadline then
      -- It may have exited since the check; then there is nothing to kill.
      try child.kill catch _ => pure ()
      timedOut := true
      break
    IO.sleep 20
  let exitCode ← match ← IO.wait exit with
    | .ok c => pure c
    | .error e => return .error (.other (toString e))
  -- A killed child's own children may still hold its pipes; what reached
  -- them by now is all a timed-out run reports.
  let drained (t : Task (Except IO.Error String)) : IO String := do
    if timedOut then
      let giveUp := (← IO.monoMsNow) + 1000
      while !(← IO.hasFinished t) && (← IO.monoMsNow) < giveUp do IO.sleep 20
      unless ← IO.hasFinished t do return ""
    match ← IO.wait t with
    | .ok s => pure s
    | .error _ => pure ""
  let stderr ← drained err
  -- Lean forks before it execs, so a command that cannot be run is a child
  -- exiting 255 with this line, not an error from `spawn`.
  if exitCode == 255 && stderr.startsWith "could not execute external process" then
    return .error (.notFound stderr.trimAsciiEnd.toString)
  return .ok { exitCode, stdout := ← drained out, stderr, timedOut }

/-- `2026-10-15T07:02:47.147Z` for `ms` milliseconds after the Unix
epoch: `Date.prototype.toISOString`'s spelling, for the years it spells
with four digits. -/
def isoOfMillis (ms : Int) : String :=
  let pad (w : Nat) (n : Int) : String :=
    let s := toString n.natAbs
    "".pushn '0' (w - s.length) ++ s
  let days := ms / 86400000
  let inDay := ms % 86400000
  -- Howard Hinnant's days-to-civil, for the proleptic Gregorian calendar.
  let z := days + 719468
  let era := (if z ≥ 0 then z else z - 146096) / 146097
  let doe := z - era * 146097
  let yoe := (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
  let doy := doe - (365 * yoe + yoe / 4 - yoe / 100)
  let mp := (5 * doy + 2) / 153
  let d := doy - (153 * mp + 2) / 5 + 1
  let m := if mp < 10 then mp + 3 else mp - 9
  let y := yoe + era * 400 + (if m ≤ 2 then 1 else 0)
  s!"{pad 4 y}-{pad 2 m}-{pad 2 d}T{pad 2 (inDay / 3600000)}:{pad 2 (inDay / 60000 % 60)}:\
    {pad 2 (inDay / 1000 % 60)}.{pad 3 (inDay % 1000)}Z"

/-- Now, as `isoOfMillis` spells it. -/
def isoNow : IO String := do
  return isoOfMillis (← Std.Time.Timestamp.now).toMillisecondsSinceUnixEpoch.val

/-- The termination signals a run can still report on, with their numbers.
Each is delivered to the whole foreground process group — Ctrl-C at the
terminal, a supervisor's kill, a CI cancel — so the engine's child dies
of it too. SIGKILL is out of contract: nothing can be printed. -/
def interruptSignals : List (String × Int32) := [("SIGINT", 2), ("SIGTERM", 15), ("SIGHUP", 1)]

/-- Run `body` with the default disposition of `interruptSignals`
replaced, so a signal kills the engine's child without killing the tool
before it can report. `body` is handed `interrupted`, which answers with
the first of them that reached this process. That, not the child's
death, is what a run reads: an engine may catch the signal and exit by
status rather than die of it, and a child killed by its own timeout
looks no different from one killed by the user. -/
def withInterruptGuard {α : Type} (body : IO (Option String) → IO α) : IO α := do
  let armed ← interruptSignals.mapM fun (name, n) => do
    -- Repeating, so the handler stays installed after the first delivery:
    -- a second Ctrl-C while the engine dies must not find the default
    -- disposition back and kill the tool before it reports.
    let s ← Std.Internal.UV.Signal.mk n true
    return (name, s, ← s.next)
  let interrupted : IO (Option String) := do
    -- The handler runs on the event loop's thread: give a signal that
    -- has just killed the child time to be recorded.
    IO.sleep 50
    for (name, _, p) in armed do
      if ← IO.hasFinished p.result? then return some name
    return none
  try body interrupted
  finally
    for (_, s, _) in armed do
      try s.stop catch _ => pure ()

end Thales
