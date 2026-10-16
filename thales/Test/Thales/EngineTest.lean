import Thales.Engine

open Thales

#guard heartbeatArgs none none == #[]
#guard heartbeatArgs (some "7") (some "1") == #["-Dweak.thales.heartbeats=7", "-Dweak.thales.validateHeartbeats=1"]
-- Zero and junk are not budgets.
#guard heartbeatArgs (some "0") (some "x1") == #[]
#guard heartbeatArgs (some "") (some "-3") == #[]
#guard validateCount "#thales_validate a\nfoo\n#thales_validate b\n  #thales_validate c\n" == 2

#guard interruptedBy { status := some 129, stdout := "", stderr := "" } == some "SIGHUP"
#guard interruptedBy { status := some 143, stdout := "", stderr := "", timedOut := true } == none

#eval show IO Unit from do
  -- A child killed by a signal is an interruption; our own kill is not.
  let r ← runWithTimeout "sh" #["-c", "kill -TERM $$"] none 10000
  unless interruptedBy r == some "SIGTERM" do throw (IO.userError s!"got {r.status}")
  let r ← runWithTimeout "sh" #["-c", "kill -INT $$"] none 10000
  unless interruptedBy r == some "SIGINT" do throw (IO.userError s!"got {r.status}")
  -- The deadline kills the child and says so, even when a grandchild
  -- holds the pipes open.
  let t0 ← IO.monoMsNow
  let r ← runWithTimeout "sh" #["-c", "sleep 30; :"] none 200
  unless r.timedOut && interruptedBy r == none do throw (IO.userError "timeout misreported")
  unless (← IO.monoMsNow) - t0 < 5000 do throw (IO.userError "the deadline did not stop the run")
  -- A grandchild that ignores SIGTERM is killed once the grace runs out,
  -- so it cannot hold the pipes open past the deadline.
  let t0 ← IO.monoMsNow
  let r ← runWithTimeout "sh" #["-c", "sh -c 'trap \"\" TERM; sleep 30'; :"] none 500
  unless r.timedOut do throw (IO.userError "TERM-proof grandchild: no timeout")
  unless (← IO.monoMsNow) - t0 < 5000 do throw (IO.userError "a TERM-proof grandchild outlived the deadline")
  -- Both streams and the status come back.
  let r ← runWithTimeout "sh" #["-c", "echo out; echo err >&2; exit 3"] none 10000
  unless r.status == some 3 && r.stdout == "out\n" && r.stderr == "err\n" do throw (IO.userError "streams")
  -- A command that is not there fails to start.
  let r ← runWithTimeout "/nonexistent/lake" #[] none 1000
  unless r.failedToStart.isSome do throw (IO.userError "should not start")
