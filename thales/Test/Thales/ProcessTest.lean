import Thales.Process
import Thales.Engine

open Thales

-- `Date.prototype.toISOString`'s spelling.
#guard isoOfMillis 0 = "1970-01-01T00:00:00.000Z"
#guard isoOfMillis 1792047767147 = "2026-10-15T07:02:47.147Z"
#guard isoOfMillis 951782400000 = "2000-02-29T00:00:00.000Z"
#guard isoOfMillis 4107542399999 = "2100-02-28T23:59:59.999Z"

def expect (ok : Bool) (what : String) : IO Unit :=
  unless ok do throw (IO.userError s!"expected {what}")

-- A child's output and status come back whole.
#eval show IO Unit from do
  let r ← match ← runWithin "sh" #["-c", "echo out; echo err >&2; exit 3"] "." 10000 with
    | .ok r => pure r
    | .error _ => throw (IO.userError "sh did not run")
  expect (r.exitCode == 3 && r.stdout == "out\n" && r.stderr == "err\n" && !r.timedOut)
    s!"exit 3 with both streams, got {r.exitCode} {repr r.stdout} {repr r.stderr}"

-- A child past its budget is killed and says so.
#eval show IO Unit from do
  let t0 ← IO.monoMsNow
  let r ← match ← runWithin "sleep" #["30"] "." 200 with
    | .ok r => pure r
    | .error _ => throw (IO.userError "sleep did not run")
  expect (r.timedOut && (← IO.monoMsNow) - t0 < 10000) "a timed-out kill well inside the sleep"

-- A command that is not there is an answer, not an exception.
#eval show IO Unit from do
  match ← runWithin "no-such-command-thales-test" #[] "." 1000 with
  | .error (.notFound _) => pure ()
  | _ => throw (IO.userError "expected notFound")

-- The engine root is found from the executable's directory, under
-- `thales/` from an enclosing one, and not at all past the filesystem root.
#eval show IO Unit from do
  let some root ← findEngineRoot ((← IO.currentDir) / ".lake" / "build" / "bin")
    | throw (IO.userError "no engine root above .lake/build/bin")
  expect (← (root / "lakefile.lean").pathExists) "a lakefile at the root found"
  if (← findEngineRoot "/").isSome then throw (IO.userError "an engine root above /")
