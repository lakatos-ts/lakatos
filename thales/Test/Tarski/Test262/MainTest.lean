import Tarski.Test262.Main

open Tarski.Test262
open System (FilePath)

/-! The command line and the run loop over the fake tree, with the fake
binary in the evaluator's place and this checkout's lemma parsing. Run
from `thales/`, after `npm run build` at the repo root. -/

def TREE : FilePath := "Test/fixtures/test262"
def FAKE : FilePath := "Test/fixtures/fake-tarski.sh"
def LEMMA : FilePath := "../lemma/dist/cli.js"

-- These tests read the package's files by relative path.
#eval show IO Unit from do
  unless ← ("lakefile.lean" : System.FilePath).pathExists do
    throw (IO.userError "run from thales/, as lake build Test does")

def expect (what : String) (ok : Bool) : IO Unit :=
  unless ok do throw (IO.userError s!"failed: {what}")

def has (hay needle : String) : Bool := (hay.splitOn needle).length > 1

structure Ran where
  status : UInt32
  stdout : String
  stderr : String

/-- `cli` with both streams captured, the way a person reads them. -/
def invokeWith (argv : List String) (checkoutEnv : Option String := none)
    (lemma : IO (Except String FilePath) := do
      if ← LEMMA.pathExists then return .ok ((← IO.currentDir) / LEMMA)
      else return .error s!"no lemma at {LEMMA}: run npm run build at the repo root") : IO Ran := do
  let out ← IO.mkRef (#[] : Array String)
  let err ← IO.mkRef (#[] : Array String)
  let status ← cli argv { root := ← IO.currentDir, checkoutEnv, lemma, jobs := pure 4,
                          out := fun l => out.modify (·.push l), err := fun l => err.modify (·.push l) }
  return { status, stdout := "\n".intercalate (← out.get).toList, stderr := "\n".intercalate (← err.get).toList }

def invoke (argv : List String) : IO Ran := invokeWith argv

def fake : IO String := return toString ((← IO.currentDir) / FAKE)

def overTree (extra : List String := []) : IO (List String) := do
  return ["test", "--test262", toString TREE, "--binary", ← fake, "--timeout", "1000"] ++ extra

def overPass (extra : List String := []) : IO (List String) := do
  return ["test/pass", "--test262", toString TREE, "--binary", ← fake] ++ extra

/-- The fake tree has one directory per outcome class, so this is the whole
table shape and every row of it at once. -/
def TABLE : String := "\n".intercalate [
  "directory           pass  fail  unsupported  timeout  harness-error  not-run",
  "test/fail              0     4            0        0              0        0",
  "test/harness-error     0     0            0        0              2        0",
  "test/not-run           0     0            0        0              0        4",
  "test/pass              6     0            0        0              0        0",
  "test/timeout           0     0            0        1              0        0",
  "test/unsupported       0     0            3        0              0        0"]

-- One run of the whole tree, read three ways: the timeout is paid once.
#eval show IO Unit from do
  let r ← invoke (← overTree)
  expect "status 0" (r.status == 0)
  expect "the table" (r.stdout.startsWith TABLE)
  expect "not-run reasons" (has r.stdout "not run:\n  async  1\n  module  1\n  noStrict  1\n  raw  1")
  expect "skip reasons" (has r.stdout "skipped:\n  intl402  1\n  parse-negative  1\n  resolution-negative  1")
  expect "unsupported kinds" (has r.stdout "unsupported:\n  FunctionDeclaration generator  2\n  $262.evalScript  1")
  expect "a failure" (has r.stdout "test/fail/assert-fails.js  Uncaught Test262Error: boom")
  expect "a wrong class" (has r.stdout "test/fail/negative-wrong-class.js  expected an uncaught TypeError, got Uncaught RangeError: r")
  expect "a missing include" (has r.stdout "test/harness-error/missing-include.js  no harness file nope.js")
  expect "a syntax error, named as the parse names it" (has r.stdout "test/harness-error/syntax-error.js  test262:")
  expect "the timeout" (has r.stdout "timeouts:\n  test/timeout/loops.js")

-- --write round-trips through --check
#eval show IO Unit from do
  let file := (← scratchDir "main-test") / "expected.json"
  expect "write" ((← invoke (← overPass ["--write", toString file])).status == 0)
  let checked ← invoke (← overPass ["--check", toString file])
  expect "check" (checked.status == 0 && has checked.stdout s!"expectations match {file}")

-- --check exits 1 and names the count that moved
#eval show IO Unit from do
  let file := (← scratchDir "main-test") / "edited.json"
  let _ ← invoke (← overPass ["--write", toString file])
  let table ← IO.ofExcept (readExpectations (← IO.FS.readFile file))
  IO.FS.writeFile file (renderExpectations (table.map fun (d, c) => if d == "test/pass" then (d, { c with pass := 5 }) else (d, c)))
  let checked ← invoke (← overPass ["--check", toString file])
  expect "exit 1" (checked.status == 1)
  expect "names the count" (has checked.stderr "test/pass: pass expected 5, got 6")

-- --check with an expectations file that cannot be read
#eval show IO Unit from do
  let r ← invoke (← overPass ["--check", "nowhere.json"])
  expect "exit 2" (r.status == 2 && has r.stderr "nowhere.json")

-- --summary: the table and the counts, no lists, a line of progress per group
#eval show IO Unit from do
  let r ← invoke (← overTree ["--summary"])
  expect "status" (r.status == 0 && r.stdout.startsWith TABLE)
  expect "counts" (has r.stdout "not run:" && has r.stdout "skipped:" && has r.stdout "unsupported:")
  expect "no lists" (!has r.stdout "failures:" && !has r.stdout "harness errors:" && !has r.stdout "timeouts:")
  expect "progress" (r.stderr == "\n".intercalate [
    "  4/23  test/fail", "  6/23  test/harness-error", "  7/23  test/intl402", "  11/23  test/not-run",
    "  17/23  test/pass", "  19/23  test/skipped", "  20/23  test/timeout", "  23/23  test/unsupported"])

-- --budget 0: every planned run is `budget` and nothing is spawned; the
-- timeout row's zero is the witness, its test diverging if spawned.
#eval show IO Unit from do
  let r ← invoke (← overTree ["--budget", "0"])
  expect "status" (r.status == 0)
  expect "the table" (r.stdout.startsWith ("\n".intercalate [
    "directory           pass  fail  unsupported  timeout  harness-error  not-run",
    "test/fail              0     0            0        0              0        4",
    "test/harness-error     0     0            0        0              1        1",
    "test/not-run           0     0            0        0              0        4",
    "test/pass              0     0            0        0              0        6",
    "test/timeout           0     0            0        0              0        1",
    "test/unsupported       0     0            0        0              0        3"]))
  expect "budget count" (has r.stdout "budget  15")

-- a budget that is not a non-negative integer
#eval show IO Unit from do
  for value in ["-1", "soon", "1e3"] do
    let r ← invoke ["test", "--budget", value]
    expect s!"budget {value}" (r.status == 2 && has r.stderr "--budget needs a non-negative integer")

-- --markdown and --json, labelled with what was run
#eval show IO Unit from do
  let dir ← scratchDir "main-test"
  let (md, json) := (dir / "results.md", dir / "results.json")
  let r ← invoke (← overPass ["--markdown", toString md, "--json", toString json])
  expect "status" (r.status == 0 && has r.stdout s!"wrote {json}" && has r.stdout s!"wrote {md}")
  let j ← IO.ofExcept (Lean.Json.parse (← IO.FS.readFile json))
  -- The fixture tree is not a repository: no commit, nothing to warn about.
  expect "null commit" ((j.getObjValD "test262").getObjValD "commit" == Lean.Json.null)
  expect "slices" (j.getObjValD "slices" == Lean.Json.arr #["test/pass"])
  expect "timeout" (j.getObjValD "timeoutMs" == (10000 : Nat))
  expect "totals" ((j.getObjValD "totals").getObjValD "pass" == (6 : Nat))
  expect "no warning" (!has r.stderr "the pin is")
  let doc ← IO.FS.readFile md
  expect "markdown" (doc.startsWith "# test262 results\n" && has doc "| test/pass |")

-- either file on its own
#eval show IO Unit from do
  let md := (← scratchDir "main-test") / "alone.md"
  let r ← invoke (← overPass ["--markdown", toString md])
  expect "alone" (r.status == 0 && has r.stdout s!"wrote {md}" && !has r.stdout ".json")
  expect "written" ((← IO.FS.readFile md).startsWith "# test262 results\n")

-- labels the table with the checkout's HEAD and warns off the pin
#eval show IO Unit from do
  let copy := (← scratchDir "test262-copy") / "tree"
  let _ ← IO.Process.output { cmd := "cp", args := #["-R", toString TREE, toString copy] }
  for args in [#["init", "--quiet"], #["config", "user.email", "test@example.com"],
               #["config", "user.name", "Test"], #["add", "."], #["commit", "--quiet", "-m", "one"]] do
    let _ ← git args copy
  let head := toString (← git #["rev-parse", "HEAD"] copy).trimAscii
  let json := (← scratchDir "main-test") / "labelled.json"
  let r ← invoke ["test/pass", "--test262", toString copy, "--binary", ← fake, "--json", toString json]
  expect "status" (r.status == 0)
  let j ← IO.ofExcept (Lean.Json.parse (← IO.FS.readFile json))
  expect "labelled" ((j.getObjValD "test262").getObjValD "commit" == Lean.Json.str head)
  let pin ← readPin "test262/pin.json"
  expect "warned" (has r.stderr s!"test262 checkout is at {head}, the pin is {pin.commit}")

-- --slice-file
#eval show IO Unit from do
  let dir ← scratchDir "main-test"
  IO.FS.writeFile (dir / "slice.txt") "# what this slice is\n\ntest/pass\n  test/fail  \n\n# trailing note\n"
  let fromFile ← invoke ["--slice-file", toString (dir / "slice.txt"), "--test262", toString TREE, "--binary", ← fake]
  let fromArgs ← invoke ["test/pass", "test/fail", "--test262", toString TREE, "--binary", ← fake]
  expect "same as arguments" (fromFile.status == 0 && fromFile.stdout == fromArgs.stdout)
  IO.FS.writeFile (dir / "one.txt") "test/fail\n"
  let appended ← invoke ["test/pass", "--slice-file", toString (dir / "one.txt"), "--test262", toString TREE, "--binary", ← fake]
  expect "appends" (appended.status == 0 && has appended.stdout "test/pass" && has appended.stdout "test/fail")
  let missing := toString (dir / "nowhere.txt")
  let r ← invoke ["--slice-file", missing, "--test262", toString TREE]
  expect "missing file" (r.status == 2 && has r.stderr s!"cannot read {missing}")
  let r ← invoke ["--slice-file"]
  expect "no value" (r.status == 2 && has r.stderr "--slice-file needs a value")
  IO.FS.writeFile (dir / "empty.txt") "# nothing here yet\n"
  let r ← invoke ["--slice-file", toString (dir / "empty.txt"), "--test262", toString TREE]
  expect "empty" (r.status == 2 && has r.stderr "at least one slice is needed")

-- usage
#eval show IO Unit from do
  let r ← invoke ["--test262", toString TREE]
  expect "a slice is needed" (r.status == 2 && has r.stderr "at least one slice is needed")
  expect "usage printed" (has r.stderr "usage: tarski-test262 <slice>...")
  let r ← invoke ((← overPass) ++ ["--nope", "x"])
  expect "unknown flag" (r.status == 2 && has r.stderr "unknown flag --nope")
  let r ← invoke ["test", "--test262"]
  expect "no value" (r.status == 2 && has r.stderr "--test262 needs a value")
  let r ← invoke ["test", "--timeout", "soon"]
  expect "bad timeout" (r.status == 2 && has r.stderr "--timeout needs a positive integer")
  let r ← invoke ["test", "--jobs", "0"]
  expect "bad jobs" (r.status == 2 && has r.stderr "--jobs needs a positive integer")
  let r ← invoke ["test", "--test262", "/nothing-here"]
  expect "no checkout" (r.status == 2 && has r.stderr "no test262 checkout at" && has r.stderr "tarski-test262 setup")
  let r ← invoke ["test", "--test262", toString TREE, "--binary", "/nothing-here/tarski"]
  expect "no binary" (r.status == 2 && has r.stderr "no evaluator at" && has r.stderr "lake build tarski")
  let r ← invoke ["setup", "extra"]
  expect "setup extra" (r.status == 2 && has r.stderr "usage: tarski-test262 setup")
  let r ← invoke ["setup", "--pin"]
  expect "setup --pin alone" (r.status == 2 && has r.stderr "usage: tarski-test262 setup")
  let r ← invokeWith (← overPass) (lemma := pure (.error "no lemma here"))
  expect "no lemma" (r.status == 2 && has r.stderr "tarski-test262: no lemma here")

-- the default checkout is LAKATOS_TEST262; the default binary may or may
-- not be built, and either answer exercises the arm
#eval show IO Unit from do
  expect "env checkout" ((← invokeWith ["test/pass", "--binary", ← fake] (checkoutEnv := some (toString TREE))).status == 0)
  expect "default binary" ([0, 2].contains (← invokeWith ["test/pass"] (checkoutEnv := some (toString TREE))).status)

-- setup fetches the pinned commit into LAKATOS_TEST262, and is a no-op after
#eval show IO Unit from do
  let origin ← scratchDir "test262-origin"
  let target := (← scratchDir "test262-target") / "checkout"
  for args in [#["init", "--quiet"], #["config", "user.email", "test@example.com"], #["config", "user.name", "Test"]] do
    let _ ← git args origin
  IO.FS.writeFile (origin / "README.md") "one\n"
  let _ ← git #["add", "."] origin
  let _ ← git #["commit", "--quiet", "-m", "one"] origin
  let commit := toString (← git #["rev-parse", "HEAD"] origin).trimAscii
  let pin := (← scratchDir "main-test") / "pin.json"
  IO.FS.writeFile pin (Lean.Json.mkObj [("repository", toString origin), ("commit", commit)]).pretty
  let r ← invokeWith ["setup", "--pin", toString pin] (checkoutEnv := some (toString target))
  expect "fetched" (r.status == 0 && has r.stdout commit)
  expect "at the pin" (toString (← git #["rev-parse", "HEAD"] target).trimAscii == commit)
  let again ← invokeWith ["setup", "--pin", toString pin] (checkoutEnv := some (toString target))
  expect "no-op" (again.status == 0 && again.stdout == s!"test262 already at {commit}")

-- --shard
def SLICES : List String :=
  ["test/fail", "test/harness-error", "test/not-run", "test/pass", "test/timeout", "test/unsupported"]

def slicesOf (argv : List String) : IO (Array String) := do
  match ← parseArgs argv with
  | .ok o => return o.slices
  | .error e => throw (IO.userError e)

def refusal (argv : List String) : IO String := do
  match ← parseArgs argv with
  | .ok _ => return ""
  | .error e => return e

#eval show IO Unit from do
  let all ← slicesOf SLICES
  let parts ← [1, 2, 3].mapM fun i => slicesOf (SLICES ++ ["--shard", s!"{i}/3"])
  let flat := parts.foldl (· ++ ·) #[]
  expect "the shards together are the whole list" (flat.qsort (· < ·) == all.qsort (· < ·))
  expect "no slice twice" (flat.size == all.size)
  expect "round-robin" (parts.head! == #["test/fail", "test/pass"])
  expect "malformed" (has (← refusal (SLICES ++ ["--shard", "half"])) "--shard must look like \"2/3\", got: half")
  expect "out of range" (has (← refusal (SLICES ++ ["--shard", "4/3"])) "--shard index out of range for 3 shards")
  expect "zero" (has (← refusal (SLICES ++ ["--shard", "1/0"])) "--shard count must be at least 1")
  expect "with merge" (has (← refusal ["--merge", "a.json", "--shard", "1/3"]) "--shard and --merge are different runs")

-- --merge: three shards merged are the unsharded table
#eval show IO Unit from do
  let dir ← scratchDir "main-test"
  let over (extra : List String) : IO (List String) := do
    return SLICES ++ ["--test262", toString TREE, "--binary", ← fake, "--timeout", "1000"] ++ extra
  let whole := toString (dir / "whole.json")
  expect "whole" ((← invoke (← over ["--write", whole])).status == 0)
  let mut parts := #[]
  for i in [1, 2, 3] do
    let file := toString (dir / s!"shard-{i}.json")
    expect s!"shard {i}" ((← invoke (← over ["--shard", s!"{i}/3", "--write", file])).status == 0)
    parts := parts.push file
  let merges := parts.toList.flatMap fun f => ["--merge", f]
  let merged := toString (dir / "merged.json")
  expect "merged" ((← invoke (merges ++ ["--write", merged])).status == 0)
  expect "equal to the whole, structurally"
    ((readExpectations (← IO.FS.readFile merged)).toOption == (readExpectations (← IO.FS.readFile whole)).toOption)
  let r ← invoke (merges ++ ["--check", whole])
  expect "union checks" (r.status == 0 && has r.stdout "expectations match")
  -- A shard's own table misses every directory it was not given.
  let r ← invoke ["--merge", parts[0]!, "--check", whole]
  expect "one shard alone" (r.status == 1 && has r.stderr "expected but not run")
  let r ← invoke ["--merge", parts[0]!, "--merge", parts[0]!]
  expect "a collision" (r.status == 1 && has r.stderr "counted by more than one shard")

/-! Beyond the TypeScript suite: the run loop's own failure modes. -/

/-- A lemma stand-in: answers each file with a program holding the file's
first `fake: …` literal, or, by `mode`, drops the last document or crashes. -/
def fakeLemma (mode : String) : IO FilePath := do
  let file := (← scratchDir "fake-lemma") / "fake-lemma.cjs"
  IO.FS.writeFile file (r#"const fs = require("node:fs");
const MODE = "@MODE@";
const files = process.argv.slice(2).filter((a) => a !== "--jsonl" && a !== "parse");
if (MODE === "crash") {
  process.stderr.write("lemma: boom\n");
  process.exit(3);
}
for (const file of MODE === "drop" ? files.slice(0, -1) : files) {
  const m = /"(fake: [^"]*)"/.exec(fs.readFileSync(file, "utf8"));
  const body = m === null ? [] : [{ type: "ExpressionStatement",
    expression: { type: "Literal", value: m[1], raw: JSON.stringify(m[1]) } }];
  const program = { type: "Program", sourceType: "script", body };
  process.stdout.write(JSON.stringify({ schemaVersion: 1, file, gated: false, outcome: "program", program }) + "\n");
}
"#.replace "@MODE@" mode)
  return file

/-- A scratch checkout: the fake tree's harness and `tests` (path, text). -/
def treeOf (tests : List (String × String)) : IO FilePath := do
  let root ← scratchDir "test262-tree"
  IO.FS.createDirAll (root / "harness")
  for name in ["sta.js", "assert.js"] do
    IO.FS.writeFile (root / "harness" / name) (← IO.FS.readFile (TREE / "harness" / name))
  for (rel, text) in tests do
    let p := root / rel
    if let some parent := p.parent then IO.FS.createDirAll parent
    IO.FS.writeFile p text
  return root

def marked (marker : String) : String := s!"/*---\ndescription: x\n---*/\nconst $fake = \"fake: {marker}\";\n"

-- A lemma that drops a document or crashes fails its batch: the message
-- once on stderr, every run in the batch a harness error, the rest of the
-- table intact.
#eval show IO Unit from do
  for mode in ["drop", "crash"] do
    let lemma ← fakeLemma mode
    let r ← invokeWith ["test/pass", "test/not-run", "--test262", toString TREE, "--binary", ← fake]
      (lemma := pure (.ok lemma))
    expect s!"{mode}: status" (r.status == 0)
    expect s!"{mode}: the batch" (has r.stdout "test/not-run     0     0            0        0              0        4")
    expect s!"{mode}: harness errors" (has r.stdout "test/pass        0     0            0        0              6        0")
    expect s!"{mode}: said once" ((r.stderr.splitOn "tarski-test262: lemma").length == 2)
    expect s!"{mode}: the detail" (has r.stdout "test/pass/passes.js  lemma did not answer for this batch")

-- The budget runs out while a child is running: that child finishes and
-- is counted, and nothing after it starts.
#eval show IO Unit from do
  let root ← treeOf [("test/a/hang.js", marked "timeout"), ("test/b/one.js", marked "exit 0"),
                     ("test/b/two.js", marked "exit 0")]
  let r ← invokeWith ["test", "--test262", toString root, "--binary", ← fake, "--jobs", "1",
                      "--budget", "3000", "--timeout", "6000"] (lemma := do return .ok (← fakeLemma "ok"))
  expect "status" (r.status == 0)
  expect "the running child is counted" (has r.stdout "test/a        0     0            0        1              0        0")
  expect "the rest are budget" (has r.stdout "test/b        0     0            0        0              0        2")
  expect "named" (has r.stdout "budget  2")

-- A child whose stderr is not UTF-8 is that test's harness error, not the run's.
#eval show IO Unit from do
  let bin := (← scratchDir "latin1-tarski") / "tarski.sh"
  IO.FS.writeFile bin "#!/bin/sh\nprintf 'Uncaught \\351\\n' >&2\nexit 1\n"
  let _ ← IO.Process.output { cmd := "chmod", args := #["+x", toString bin] }
  let root ← treeOf [("test/a/one.js", marked "exit 0"), ("test/a/two.js", marked "exit 0")]
  let r ← invokeWith ["test", "--test262", toString root, "--binary", toString bin]
    (lemma := do return .ok (← fakeLemma "ok"))
  expect "status" (r.status == 0)
  expect "both rows" (has r.stdout "test/a        0     0            0        0              2        0")

-- Paths with spaces and non-ASCII names are rows like any other.
#eval show IO Unit from do
  let root ← treeOf [("test/odd dir/a b.js", marked "exit 0"), ("test/odd dir/ü.js", marked "exit 0"),
                     ("test/odd dir/it's.js", marked "exit 1 Uncaught Test262Error: q")]
  -- And a file that is not UTF-8 is that test's harness error, not the run's.
  IO.FS.writeBinFile (root / "test" / "odd dir" / "latin1.js") (ByteArray.mk #[0x63, 0xe9, 0x0a])
  let r ← invokeWith ["test/odd dir", "--test262", toString root, "--binary", ← fake]
    (lemma := do return .ok (← fakeLemma "ok"))
  expect "status" (r.status == 0)
  expect "the row" (has r.stdout "test/odd dir     2     1            0        0              1")
  expect "the failure's path" (has r.stdout "test/odd dir/it's.js  Uncaught Test262Error: q")
  expect "the unreadable file" (has r.stdout "test/odd dir/latin1.js  cannot read test/odd dir/latin1.js")

-- The table does not depend on how many children run at once.
#eval show IO Unit from do
  let one ← invoke (← overPass ["--jobs", "1"])
  let many ← invoke (← overPass ["--jobs", "8"])
  expect "same output" (one.status == 0 && one.stdout == many.stdout)
