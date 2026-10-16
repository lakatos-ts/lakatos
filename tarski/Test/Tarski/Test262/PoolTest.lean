import Tarski.Test262.Pool

open Tarski.Test262

def expect (what : String) (ok : Bool) : IO Unit :=
  unless ok do throw (IO.userError s!"failed: {what}")

-- The status and stderr come back; stdout is dropped.
#eval show IO Unit from do
  let r ← runWithTimeout "sh" #["-c", "echo out; echo err >&2; exit 3"] 10000
  expect "status and stderr" (r.status == some 3 && r.stderr == "err\n" && !r.timedOut)

-- A signaled death is 128 plus the signal, not a timeout.
#eval show IO Unit from do
  let r ← runWithTimeout "sh" #["-c", "kill -SEGV $$"] 10000
  expect "signaled" (r.status == some 139 && !r.timedOut)

-- The deadline kills the child and says so.
#eval show IO Unit from do
  let t0 ← IO.monoMsNow
  let r ← runWithTimeout "sh" #["-c", "sleep 30"] 200
  expect "timed out" (r.timedOut && r.status == none)
  expect "promptly" ((← IO.monoMsNow) - t0 < 3000)

-- A child that ignores SIGTERM is killed all the same.
#eval show IO Unit from do
  let t0 ← IO.monoMsNow
  let r ← runWithTimeout "sh" #["-c", "trap '' TERM; while :; do :; done"] 200
  expect "stubborn child" (r.timedOut && (← IO.monoMsNow) - t0 < 3000)

-- A grandchild that ignores SIGTERM and holds stderr open is killed after
-- the grace period, so the drain ends.
#eval show IO Unit from do
  let t0 ← IO.monoMsNow
  let r ← runWithTimeout "sh" #["-c", "sh -c 'trap \"\" TERM; while :; do sleep 1; done' & wait"] 200
  expect "stubborn grandchild" (r.timedOut && (← IO.monoMsNow) - t0 < 200 + killGraceMs + 3000)

-- A command that is not there fails to start.
#eval show IO Unit from do
  let r ← runWithTimeout "/nonexistent/tarski" #[] 1000
  expect "failed to start" r.failedToStart.isSome

-- The pool: index order, settled items, and never more than `jobs` at once.
#eval show IO Unit from do
  let live ← IO.mkRef 0
  let peak ← IO.mkRef 0
  let seen ← IO.mkRef (#[] : Array Nat)
  let results ← runPool 2 6 (fun i => pure <|
      if i % 3 == 0 then .settled (i * 10) else .spawn do
        let now ← live.modifyGet fun n => (n + 1, n + 1)
        peak.modify (max now)
        IO.sleep 100
        live.modify (· - 1)
        return i * 10)
    (fun i _ => seen.modify (·.push i))
  expect "index order" (results == #[0, 10, 20, 30, 40, 50])
  expect "at most two" ((← peak.get) ≤ 2)
  expect "every result reported" ((← seen.get).qsort (· < ·) == #[0, 1, 2, 3, 4, 5])

-- `step` is asked in index order, one item at a time.
#eval show IO Unit from do
  let asked ← IO.mkRef (#[] : Array Nat)
  let _ ← runPool 3 5 (fun i => do asked.modify (·.push i); return .spawn (pure i))
  expect "step order" ((← asked.get) == #[0, 1, 2, 3, 4])

#eval show IO Unit from do
  expect "an empty pool" ((← runPool 4 0 (fun i => pure (Step.settled i))) == #[])

-- One slot's long child does not hold up another's result: no child's
-- stderr pipe leaks into its neighbor.
#eval show IO Unit from do
  let t0 ← IO.monoMsNow
  let quick ← IO.mkRef 0
  let _ ← runPool 2 2 (fun i => pure <| .spawn do
      if i == 0 then runWithTimeout "sh" #["-c", "sleep 3"] 10000
      else runWithTimeout "sh" #["-c", "exit 0"] 10000)
    (fun i _ => do if i == 1 then quick.set ((← IO.monoMsNow) - t0))
  expect "the quick child lands first" ((← quick.get) < 2000)
