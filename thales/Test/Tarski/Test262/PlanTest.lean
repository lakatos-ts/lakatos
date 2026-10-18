import Tarski.Test262.Plan

open Tarski.Test262
open System (FilePath)

/-! Run from `thales/`, as `lake build Test` and `lake env lean` do. -/

/-- The fake tree: one file per decision the planner makes. -/
def ROOT : FilePath := "Test/fixtures/test262"

def readHarness (name : String) : IO (Option String) := do
  let p := ROOT / "harness" / name
  if ← p.pathExists then return some (← IO.FS.readFile p) else return none

def plan (rel : String) : IO (Except String Plan) := do
  planTest rel (← IO.FS.readFile (ROOT / rel)) readHarness

/-- The plan, or none when planning failed. -/
def planned (rel : String) : IO (Option Plan) := do
  return (← plan rel).toOption

/-- The run plan's source and negative, or a failure naming what came back. -/
def runOf (rel : String) : IO (String × Option String) := do
  match ← plan rel with
  | .ok (.run source negative) => return (source, negative)
  | other => throw (IO.userError s!"{rel}: expected a run, got {repr other}")

-- These tests read the package's files by relative path.
#eval show IO Unit from do
  unless ← ("lakefile.lean" : System.FilePath).pathExists do
    throw (IO.userError "run from thales/, as lake build Test does")

def expect (what : String) (ok : Bool) : IO Unit :=
  unless ok do throw (IO.userError s!"failed: {what}")

/-- The byte offset of the first `needle` in `hay`, if any. -/
def offset (hay needle : String) : Option Nat :=
  match hay.splitOn needle with
  | [_] | [] => none
  | before :: _ => some before.utf8ByteSize

-- skips
#eval do expect "intl402 by path" ((← planned "test/intl402/x.js") == some (Plan.skip .intl402))
#eval do expect "a parse-phase negative" ((← planned "test/skipped/parse-negative.js") == some (Plan.skip .parseNegative))
#eval do expect "a resolution-phase negative" ((← planned "test/skipped/resolution-negative.js") == some (Plan.skip .resolutionNegative))
-- The resolution negative is also flagged `module`; the phase is read first.
#eval do expect "phase before module" (match ← planned "test/skipped/resolution-negative.js" with | some (.skip _) => true | _ => false)

-- not run
#eval do expect "module" ((← planned "test/not-run/module.js") == some (Plan.notRun .module))
#eval do expect "raw, not strict" ((← planned "test/not-run/raw-sloppy.js") == some (Plan.notRun .raw))
#eval do expect "noStrict" ((← planned "test/not-run/no-strict.js") == some (Plan.notRun .noStrict))
#eval do expect "async" ((← planned "test/not-run/async.js") == some (Plan.notRun .async))

-- runs
#eval do
  let (source, negative) ← runOf "test/pass/passes.js"
  expect "strict first" (source.startsWith "\"use strict\";\n")
  let sta := offset source "function Test262Error(message)"
  let assert := offset source "function assert(mustBeTrue, message)"
  let test := offset source "assert.sameValue(1 + 1, 2"
  expect "sta, then assert, then the test" (match sta, assert, test with
    | some s, some a, some t => 0 < s && s < a && a < t
    | _, _, _ => false)
  expect "no negative" (negative == none)

#eval do
  let (source, _) ← runOf "test/unsupported/include-unsupported.js"
  let assert := offset source "function assert(mustBeTrue, message)"
  let kind := offset source "function kindOf(x)"
  let use := offset source "assert.sameValue(kindOf(1)"
  expect "includes after the preludes, in order" (match assert, kind, use with
    | some a, some k, some u => a < k && k < u
    | _, _, _ => false)

#eval do
  expect "a missing include" (match ← plan "test/harness-error/missing-include.js" with
    | .error e => e == "no harness file nope.js"
    | .ok _ => false)

#eval do
  let (source, _) ← runOf "test/pass/only-strict.js"
  expect "onlyStrict is the plain run" (source.startsWith "\"use strict\";\n" &&
    (offset source "function assert(mustBeTrue, message)").isSome)

#eval do
  let text ← IO.FS.readFile (ROOT / "test/pass/raw-strict.js")
  expect "a strict raw test, alone and unmodified" ((← planned "test/pass/raw-strict.js") == some (Plan.run text none))

#eval do
  let (_, negative) ← runOf "test/pass/negative-runtime.js"
  expect "a runtime negative's class" (negative == some "TypeError")

-- startsStrict's own edges: comments before the directive, either quote,
-- and an unterminated comment.
#guard startsStrict "// c\n/* d */ 'use strict' ;"
#guard !startsStrict "// c"
#guard !startsStrict "/* open \"use strict\";"
#guard !startsStrict "\"use strict\" + 1;"

-- listTests
#eval do
  expect "a directory, sorted" ((← listTests ROOT #["test/pass"]) == #[
    "test/pass/includes-block-list.js", "test/pass/negative-runtime.js",
    "test/pass/negative-test262error.js", "test/pass/only-strict.js",
    "test/pass/passes.js", "test/pass/raw-strict.js"])
#eval do
  expect "module fixtures excluded" ((← listTests ROOT #["test/skipped"]) ==
    #["test/skipped/parse-negative.js", "test/skipped/resolution-negative.js"])
#eval do expect "a single file" ((← listTests ROOT #["test/pass/passes.js"]) == #["test/pass/passes.js"])
#eval do expect "a single fixture" ((← listTests ROOT #["test/skipped/x_FIXTURE.js"]) == #[])
#eval do
  expect "recursive, sorted across slices" ((← listTests ROOT #["test/timeout", "test/intl402"]) ==
    #["test/intl402/x.js", "test/timeout/loops.js"])
#eval do expect "a slice spelled loosely" ((← listTests ROOT #["./test/timeout/"]) == #["test/timeout/loops.js"])
#eval show IO Unit from do
  let r ← (listTests ROOT #["test/nowhere"]).toBaseIO
  expect "a slice that is not there" (match r with | .error _ => true | .ok _ => false)

#guard directoryOf "test/pass/passes.js" == "test/pass"
#guard directoryOf "x.js" == "."
