import Tarski.Test262.Classify

open Tarski.Test262

def exited (status : UInt32) (stderr : String := "") : Spawned := { status := some status, stderr }

-- a process killed at the deadline is the timeout the runner imposed
#guard classify { status := none, stderr := "", timedOut := true } none == .timeout
-- a death by signal reads the same (spawnSync's `signal`)
#guard classify (exited 143) none == .timeout
#guard classify (exited 139) (some "TypeError") == .timeout
-- any other spawn failure is the runner's own machinery
#guard classify { status := none, stderr := "", failedToStart := some "spawn ENOENT" } none ==
  .harnessError "spawn ENOENT"
-- exit 3 is unsupported, with the kind
#guard classify (exited 3 "unsupported: ForStatement\n") none == .unsupported "ForStatement"
-- the whole line when exit 3 names no kind
#guard classify (exited 3 "something else\n") none == .unsupported "something else"
-- exit 0 is a pass
#guard classify (exited 0) none == .pass
-- a negative test that completed fails
#guard classify (exited 0) (some "TypeError") ==
  .fail "expected an uncaught TypeError, the script completed"
-- a negative test whose class matches passes
#guard classify (exited 1 "Uncaught TypeError: t\n") (some "TypeError") == .pass
-- Test262Error is no Error subclass; the report's own name is what is read
#guard classify (exited 1 "Uncaught Test262Error: m\n") (some "Test262Error") == .pass
-- the wrong class fails
#guard classify (exited 1 "Uncaught RangeError: r\n") (some "TypeError") ==
  .fail "expected an uncaught TypeError, got Uncaught RangeError: r"
-- a thrown value with no class name fails
#guard classify (exited 1 "Uncaught 1\n") (some "TypeError") ==
  .fail "expected an uncaught TypeError, got Uncaught 1"
-- an abrupt-completion report carries no class
#guard classify (exited 1 "Uncaught: abrupt completion outside any loop, label, or function\n") (some "SyntaxError") ==
  .fail "expected an uncaught SyntaxError, got Uncaught: abrupt completion outside any loop, label, or function"
-- an ordinary test that threw fails with the report
#guard classify (exited 1 "Uncaught Test262Error: boom\n") none == .fail "Uncaught Test262Error: boom"
-- exit 2 is the runner's own machinery
#guard classify (exited 2 "tarski: t.json: malformed\n") none == .harnessError "tarski: t.json: malformed"
-- so is any other status
#guard classify (exited 7) none == .harnessError "exit 7"

-- the name rule's edges
#guard thrownClass "Uncaught TypeError" == some "TypeError"
#guard thrownClass "Uncaught $x_1: m" == some "$x_1"
#guard thrownClass "Uncaught 1x: m" == none
#guard thrownClass "Uncaught Type Error: m" == none
#guard unsupportedKind "tarski: unsupported: a unsupported: b" == "a unsupported: b"
