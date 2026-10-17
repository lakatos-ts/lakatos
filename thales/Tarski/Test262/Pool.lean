/-! Children under a deadline, at most `jobs` at once.

The process handling is a copy of `thales/Thales/Engine.lean`'s: tarski
may not import thales. A child still running at its deadline is killed,
its descendants first with SIGTERM and then, past a grace period, with
SIGKILL, so an orphan cannot hold the stderr pipe open. -/

namespace Tarski.Test262

/-- What one child came to. -/
structure Spawned where
  /-- The exit code (a signaled death reads as 128 plus the signal), or
  none when the child was killed at the deadline. -/
  status : Option UInt32
  stderr : String
  /-- Killed at the deadline. -/
  timedOut : Bool := false
  failedToStart : Option String := none
deriving Repr, Inhabited

/-- Every live descendant of `pid`. -/
private partial def descendants (pid : Nat) : IO (Array String) := do
  let out ← try IO.Process.output { cmd := "pgrep", args := #["-P", toString pid] }
    catch _ => return #[]
  let kids := (out.stdout.splitOn "\n").filterMap (fun l => (toString l.trimAscii).toNat?) |>.toArray
  kids.foldlM (init := #[]) fun acc k => return acc.push (toString k) ++ (← descendants k)

/-- Those of `pids` still in the process table. -/
private def alive (pids : Array String) : IO (Array String) := do
  if pids.isEmpty then return #[]
  let out ← try IO.Process.output { cmd := "ps", args := #["-o", "pid=", "-p", ",".intercalate pids.toList] }
    catch _ => return #[]
  return (out.stdout.splitOn "\n").filterMap (fun l =>
    let t := toString l.trimAscii
    if t.isEmpty then none else some t) |>.toArray

private def signal (sig : String) (pids : Array String) : IO Unit := do
  unless pids.isEmpty do
    let _ ← try IO.Process.output { cmd := "kill", args := #[s!"-{sig}"] ++ pids }
      catch _ => pure { exitCode := 1, stdout := "", stderr := "" }

/-- How long the descendants get to exit on SIGTERM before SIGKILL. -/
def killGraceMs : Nat := 1500

/-- Spawn with stderr piped and drained on its own task, polled against
the deadline. stdout is discarded: the runner reads only the report. -/
def runWithTimeout (cmd : String) (args : Array String) (timeoutMs : Nat) : IO Spawned := do
  let child ←
    try
      IO.Process.spawn { cmd, args, stdin := .null, stdout := .null, stderr := .piped }
    catch e =>
      return { status := none, stderr := "", failedToStart := some (toString e) }
  let errTask ← IO.asTask child.stderr.readToEnd .dedicated
  let deadline := (← IO.monoMsNow) + timeoutMs
  let mut status : Option UInt32 := none
  let mut timedOut := false
  repeat
    if let some s ← child.tryWait then
      status := some s
      break
    if (← IO.monoMsNow) ≥ deadline then
      let tree ← descendants (UInt32.toNat child.pid)
      signal "TERM" tree
      -- `kill` is SIGKILL, so the child itself cannot ignore it.
      child.kill
      let _ ← child.wait
      -- A descendant that ignores SIGTERM would hold the pipe, and the drain, open.
      let graceEnd := (← IO.monoMsNow) + killGraceMs
      let mut left ← alive tree
      repeat
        if left.isEmpty || (← IO.monoMsNow) ≥ graceEnd then break
        IO.sleep 50
        left ← alive left
      unless left.isEmpty do
        signal "KILL" (← left.foldlM (init := left) fun acc p =>
          return acc ++ (← descendants p.toNat!))
      timedOut := true
      break
    IO.sleep 10
  let stderr ← IO.ofExcept errTask.get
  -- Lean's spawn forks before exec, so a missing command is the forked
  -- child's own exit 255 with this line, not a thrown error.
  let noExec := s!"could not execute external process '{cmd}'\n"
  if status == some 255 && stderr == noExec then
    return { status, stderr, failedToStart := some (toString stderr.trimAsciiEnd) }
  return { status, stderr, timedOut }

/-- What the pool does with item `i`: settle it without a child, or run
`act` in a slot. -/
inductive Step (α : Type) where
  | settled (a : α)
  | spawn (act : IO α)

/-- Items `0 … count-1` in order, at most `jobs` of the spawned ones running
at once. `step i` is asked on this thread, in index order, when a slot is
free, so a decision it makes (the budget) is made at the item's turn.
`onDone` sees each result as it lands; the array is in index order. -/
def runPool {α : Type} [Inhabited α] (jobs count : Nat) (step : Nat → IO (Step α))
    (onDone : Nat → α → IO Unit := fun _ _ => pure ()) : IO (Array α) := do
  let jobs := max jobs 1
  let mut results : Array (Option α) := Array.replicate count none
  let mut running : Array (Task (Nat × Except IO.Error α)) := #[]
  let mut next := 0
  while next < count || !running.isEmpty do
    if next < count && running.size < jobs then
      let i := next
      next := next + 1
      match ← step i with
      | .settled a =>
        results := results.set! i (some a)
        onDone i a
      | .spawn act =>
        running := running.push (← BaseIO.asTask (do return (i, ← act.toBaseIO)) .dedicated)
    else
      match running.toList with
      | [] => pure ()
      | t :: ts =>
        let _ ← IO.waitAny (t :: ts)
        let mut still := #[]
        for t in running do
          if ← IO.hasFinished t then
            let (i, r) := t.get
            let a ← IO.ofExcept r
            results := results.set! i (some a)
            onDone i a
          else
            still := still.push t
        running := still
  return results.map (·.getD default)

/-- The core count, for `--jobs`'s default; 1 when it cannot be read. -/
def cores : IO Nat := do
  try
    let out ← IO.Process.output { cmd := "getconf", args := #["_NPROCESSORS_ONLN"] }
    return max 1 ((toString out.stdout.trimAscii).toNat?.getD 1)
  catch _ => return 1

end Tarski.Test262
