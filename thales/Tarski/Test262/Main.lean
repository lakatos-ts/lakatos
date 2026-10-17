import Tarski.Lemma
import Tarski.Test262.Plan
import Tarski.Test262.Pool
import Tarski.Test262.Classify
import Tarski.Test262.Report
import Tarski.Test262.Setup
import Tarski.Test262.Paths

/-! `tarski-test262`: run a slice of test262 against the evaluator.

    tarski-test262 setup [--pin <pin.json>]
    tarski-test262 test/harness [--check test262/expected.json]
    tarski-test262 test/language --summary --markdown results.md
    tarski-test262 --slice-file test262/slice.txt --check test262/expected.json

A slice is a directory or a file under the checkout, a bare argument or a
line of a `--slice-file`. Every test is planned, parsed by lemma in
batches, run once against the binary in a pool of `--jobs` children, and
counted into a per-directory table. `--check` compares the table against a
committed expectations file in both directions and exits 1 on any
difference: the table is a ratchet. `--markdown` and `--json` write the
whole-suite run's committed files; `--budget` bounds the run's wall clock,
the tests past it counted as not run for `budget`; `--summary` trades the
per-test lists for a line of progress per directory group on stderr. -/

namespace Tarski.Test262

open Lean
open System (FilePath)

/-- What the command line asked for. -/
structure Options where
  slices : Array String := #[]
  /-- Tables to union instead of running anything. -/
  merge : Array String := #[]
  test262 : Option String := none
  binary : Option String := none
  timeout : Nat := 10000
  /-- None until one is asked for: a slice named by hand is one nobody wants truncated. -/
  budget : Option Nat := none
  jobs : Option Nat := none
  summary : Bool := false
  check : Option String := none
  write : Option String := none
  markdown : Option String := none
  json : Option String := none
deriving Repr, BEq, Inhabited

def valueFlags : List String :=
  ["--shard", "--merge", "--test262", "--binary", "--timeout", "--budget", "--jobs",
   "--check", "--write", "--markdown", "--json", "--slice-file"]

def usageLines : List String := [
  "usage: tarski-test262 <slice>... [--slice-file <path>] [--test262 <dir>]",
  "       [--binary <path>] [--timeout <ms>] [--budget <ms>] [--summary]",
  "       [--jobs <n>] [--check <expected.json>] [--write <expected.json>]",
  "       [--shard <i/n>] [--merge <table.json>]...",
  "       [--markdown <file>] [--json <file>]"]

def setupUsage : String := "usage: tarski-test262 setup [--pin <pin.json>]"

/-- Digits only: `Number`'s other spellings (`1e3`, ` 5`) are refused. -/
def digits? (s : String) : Option Nat :=
  if !s.isEmpty && s.all Char.isDigit then s.toNat? else none

/-- The slices a file names: one per line, in file order, `#` comments and
blank lines skipped. -/
def readSliceFile (file : String) : IO (Except String (Array String)) := do
  try
    let text ← IO.FS.readFile file
    return .ok ((text.splitOn "\n").toArray.map trim |>.filter fun l => !l.isEmpty && !l.startsWith "#")
  catch _ => return .error s!"cannot read {file}"

/-- Round-robin rather than contiguous blocks: the slice file is grouped by
area, and blocks would put a whole area in one shard. -/
def shardOf (items : Array String) (spec : String) : Except String (Array String) := do
  let bad := s!"--shard must look like \"2/3\", got: {spec}"
  let [i, n] := spec.splitOn "/" | throw bad
  let (some index, some count) := (digits? i, digits? n) | throw bad
  if count < 1 then throw "--shard count must be at least 1"
  if index < 1 || index > count then throw s!"--shard index out of range for {count} shards"
  return (items.zipIdx.filter fun (_, k) => k % count == index - 1).map (·.1)

def parseArgs (argv : List String) : IO (Except String Options) := ExceptT.run do
  let args := argv.toArray
  let mut o : Options := {}
  let mut shard : Option String := none
  let mut i := 0
  while i < args.size do
    let arg := args[i]!
    i := i + 1
    if !arg.startsWith "--" then
      o := { o with slices := o.slices.push arg }
      continue
    if arg == "--summary" then
      o := { o with summary := true }
      continue
    unless valueFlags.contains arg do throw s!"unknown flag {arg}"
    let some value := args[i]? | throw s!"{arg} needs a value"
    i := i + 1
    match arg with
    | "--shard" => shard := some value
    | "--merge" => o := { o with merge := o.merge.push value }
    | "--test262" => o := { o with test262 := some value }
    | "--binary" => o := { o with binary := some value }
    | "--check" => o := { o with check := some value }
    | "--write" => o := { o with write := some value }
    | "--markdown" => o := { o with markdown := some value }
    | "--json" => o := { o with json := some value }
    | "--budget" =>
      -- Zero is allowed: every planned run is `budget`, the arm without a clock.
      let some ms := digits? value | throw "--budget needs a non-negative integer"
      o := { o with budget := some ms }
    | "--jobs" =>
      let some n := (digits? value).filter (· > 0) | throw "--jobs needs a positive integer"
      o := { o with jobs := some n }
    | "--slice-file" => o := { o with slices := o.slices ++ (← ExceptT.mk (readSliceFile value)) }
    | _ =>
      let some ms := (digits? value).filter (· > 0) | throw "--timeout needs a positive integer"
      o := { o with timeout := ms }
  -- A merge reads tables and runs nothing, so it needs no slices.
  if o.merge.isEmpty && o.slices.isEmpty then throw "at least one slice is needed"
  if let some spec := shard then
    unless o.merge.isEmpty do throw "--shard and --merge are different runs"
    -- The slice file names disjoint subtrees, so each directory belongs to one shard.
    o := { o with slices := ← ExceptT.mk (pure (shardOf o.slices spec)) }
  return o

/-- What one test is, ready for its turn in the pool. -/
inductive Prepared where
  /-- Skipped, not run, or a plan that failed: nothing to spawn. -/
  | settled (r : Result)
  /-- A run whose source lemma did not turn into a program. -/
  | parseFailed (r : Result) (detail : String)
  | ready (r : Result) (ast : FilePath)
deriving Inhabited

/-- How many tests one lemma call parses. -/
def batchSize : Nat := 200

structure RunConfig where
  checkout : FilePath
  binary : FilePath
  lemma : FilePath
  slices : Array String
  timeoutMs : Nat
  budgetMs : Option Nat
  jobs : Nat
  scratch : FilePath
  err : String → IO Unit
  progress : Bool

/-- A refusal's message with the scratch path read back as `test262`, the
name the parse was given before lemma was a subprocess. -/
def refusalDetail (file message : String) : String :=
  if message.startsWith s!"{file}:" then s!"test262{message.drop file.length}" else message

/-- Plan tests `lo … hi-1`, write each run's source, and parse them in one
lemma call. `parse := false` (the budget is spent) settles every run as
`budget` without parsing. -/
def prepareBatch (cfg : RunConfig) (tests : Array String) (lo hi : Nat) (parse : Bool)
    (harness : IO.Ref (Std.HashMap String (Option String))) : IO (Array Prepared) := do
  let readHarness (name : String) : IO (Option String) := do
    if let some cached := (← harness.get)[name]? then return cached
    let p := cfg.checkout / "harness" / name
    let text ← if ← p.pathExists then some <$> IO.FS.readFile p else pure none
    harness.modify (·.insert name text)
    return text
  let mut out : Array Prepared := #[]
  let mut pending : Array (Nat × String) := #[]
  for i in [lo:hi] do
    let rel := tests[i]!
    let base : Result := { path := rel, directory := directoryOf rel, plan := .run none }
    -- A file that is not UTF-8 is one test's harness error, not the run's.
    let planned ← try planTest rel (← IO.FS.readFile (cfg.checkout / rel)) readHarness
      catch e => pure (.error s!"cannot read {rel}: {e}")
    match planned with
    | .error e =>
      -- A missing include is the runner's own machinery, and still a row.
      out := out.push (.settled { base with outcome := some (.harnessError e) })
    | .ok (.notRun reason) => out := out.push (.settled { base with plan := .notRun reason })
    | .ok (.skip reason) => out := out.push (.settled { base with plan := .skip reason })
    | .ok (.run source negative) =>
      let r := { base with plan := .run negative }
      if !parse then
        out := out.push (.settled { r with plan := .notRun .budget })
      else
        let file := cfg.scratch / "src" / s!"{i}.js"
        IO.FS.writeFile file source
        pending := pending.push (out.size, toString file)
        out := out.push (.parseFailed r "not parsed")
  if pending.isEmpty then return out
  match ← Tarski.Lemma.parse cfg.lemma (pending.map (·.2)) with
  | .error msg =>
    -- Said once here; each test of the batch carries a pointer to it.
    cfg.err s!"tarski-test262: {msg}"
    for (k, _) in pending do
      if let .parseFailed r _ := out[k]! then
        out := out.set! k (.parseFailed r "lemma did not answer for this batch")
  | .ok docs =>
    for ((k, file), doc) in pending.zip docs do
      let .parseFailed r _ := out[k]! | continue
      match doc with
      | .refused _ _ _ message .. =>
        out := out.set! k (.parseFailed r (refusalDetail file message))
      | .program _ _ json _ =>
        match json.getObjVal? "program" with
        | .error _ => out := out.set! k (.parseFailed r "lemma's document has no program")
        | .ok program =>
          let ast := cfg.scratch / "ast" / s!"{k + lo}.json"
          IO.FS.writeFile ast program.compress
          out := out.set! k (.ready r ast)
  for (_, file) in pending do
    try IO.FS.removeFile file catch _ => pure ()
  return out

/-- Plan, parse, and run every test under the slices, in planned order.
Once `budgetMs` is spent no new child starts: the rest are not run for
`budget`, and children already running finish. -/
def runSlices (cfg : RunConfig) : IO (Array Result) := do
  let started ← IO.monoMsNow
  let spent : IO Bool := do
    match cfg.budgetMs with
    | none => return false
    | some b => return (← IO.monoMsNow) - started ≥ b
  IO.FS.createDirAll (cfg.scratch / "src")
  IO.FS.createDirAll (cfg.scratch / "ast")
  let tests ← listTests cfg.checkout cfg.slices
  let harness ← IO.mkRef ({} : Std.HashMap String (Option String))
  let batches := (tests.size + batchSize - 1) / batchSize
  let tasks ← IO.mkRef (Array.replicate batches (none : Option (Task (Except IO.Error (Array Prepared)))))
  -- The next batch is parsed while this one runs.
  let ensure (k : Nat) : IO Unit := do
    if k < batches && (← tasks.get)[k]!.isNone then
      let parse := !(← spent)
      let lo := k * batchSize
      let t ← IO.asTask (prepareBatch cfg tests lo (min tests.size (lo + batchSize)) parse harness) .dedicated
      tasks.modify (·.set! k (some t))
  let prepared (i : Nat) : IO Prepared := do
    let k := i / batchSize
    ensure k
    ensure (k + 1)
    let some t := (← tasks.get)[k]! | throw (IO.userError "batch not started")
    let batch ← IO.ofExcept t.get
    return batch[i % batchSize]!
  let budget (r : Result) : Result := { r with plan := .notRun .budget, outcome := none }
  let step (i : Nat) : IO (Step Result) := do
    match ← prepared i with
    | .settled r => return .settled r
    | .parseFailed r detail =>
      return .settled (if ← spent then budget r else { r with outcome := some (.harnessError detail) })
    | .ready r ast =>
      if ← spent then return .settled (budget r)
      let negative := match r.plan with | .run n => n | _ => none
      return .spawn do
        -- A child the runner cannot read (stderr that is not UTF-8) is one
        -- test's harness error, not the run's.
        let outcome ←
          try pure (classify (← runWithTimeout (toString cfg.binary) #["run", toString ast] cfg.timeoutMs) negative)
          catch e => pure (.harnessError (toString e))
        try IO.FS.removeFile ast catch _ => pure ()
        return { r with outcome := some outcome }
  -- Progress in planned order: a group is reported once every test up to
  -- its last has finished, with the count finished so far.
  let groups := tests.map (groupKey ∘ directoryOf)
  let finished ← IO.mkRef (Array.replicate tests.size false)
  let frontier ← IO.mkRef 0
  let onDone (i : Nat) (_ : Result) : IO Unit := do
    unless cfg.progress do return
    finished.modify (·.set! i true)
    let mut f ← frontier.get
    while f < tests.size && (← finished.get)[f]! do
      if f + 1 == tests.size || groups[f + 1]! != groups[f]! then
        cfg.err s!"  {f + 1}/{tests.size}  {groups[f]!}"
      f := f + 1
    frontier.set f
  runPool cfg.jobs tests.size step onDone

/-- What the binary is handed besides its arguments. -/
structure Context where
  /-- The `thales/` lake package. -/
  root : FilePath
  /-- `LAKATOS_TEST262`. -/
  checkoutEnv : Option String := none
  lemma : IO (Except String FilePath) := Tarski.Lemma.resolve
  jobs : IO Nat := cores
  out : String → IO Unit := IO.println
  err : String → IO Unit := IO.eprintln

/-- An expectations file, or the reason it cannot be read. -/
def readTable (file : String) : IO (Except String Table) := do
  try
    return (readExpectations (← IO.FS.readFile file)).mapError (s!"{file}: {·}")
  catch e => return .error s!"{file}: {e}"

/-- `--write` and `--check` over `counts`: 0, 1 on a difference, 2 on an
expectations file that cannot be read. -/
def writeAndCheck (o : Options) (counts : Table) (ctx : Context) : IO UInt32 := do
  if let some file := o.write then
    IO.FS.writeFile file (renderExpectations counts)
    ctx.out s!"wrote {file}"
  if let some file := o.check then
    match ← readTable file with
    | .error msg =>
      ctx.err s!"tarski-test262: {msg}"
      return 2
    | .ok expected =>
      let diff := diffExpectations counts expected
      unless diff.isEmpty do
        diff.forM ctx.err
        return 1
      ctx.out s!"expectations match {file}"
  return 0

/-- Union the shard tables and hold the result to `--check`. Only the union
can be checked, the comparison running in both directions; the shards'
slices are disjoint subtrees, so a directory counted twice means they
overlapped. -/
def mergeAndCheck (o : Options) (ctx : Context) : IO UInt32 := do
  let mut counts : Table := #[]
  for file in o.merge do
    match ← readTable file with
    | .error msg =>
      ctx.err s!"tarski-test262: {msg}"
      return 2
    | .ok table =>
      for (d, row) in table do
        if counts.any (·.1 == d) then
          ctx.err s!"{d}: counted by more than one shard"
          return 1
        counts := counts.push (d, row)
  writeAndCheck o (counts.qsort (·.1 < ·.1)) ctx

def cli (argv : List String) (ctx : Context) : IO UInt32 := do
  if argv.head? == some "setup" then
    -- `--pin` names another pin file; the suite points it at a scratch repository.
    let pin := match argv with | ["setup", "--pin", p] => some p | _ => none
    if argv.length > (if pin.isSome then 3 else 1) then
      ctx.err setupUsage
      return 2
    try
      setupTest262 (defaultCheckout ctx.root ctx.checkoutEnv)
        (← readPin ((pin.map FilePath.mk).getD (pinPath ctx.root))) ctx.out
      return 0
    catch e =>
      ctx.err s!"tarski-test262: {e}"
      return 1
  let o ← match ← parseArgs argv with
    | .ok o => pure o
    | .error msg =>
      ctx.err s!"tarski-test262: {msg}"
      usageLines.forM ctx.err
      return 2
  unless o.merge.isEmpty do return ← mergeAndCheck o ctx
  let checkout : FilePath := (o.test262.map FilePath.mk).getD (defaultCheckout ctx.root ctx.checkoutEnv)
  unless ← (checkout / "harness" / "sta.js").pathExists do
    ctx.err s!"tarski-test262: no test262 checkout at {checkout}"
    ctx.err "run `tarski-test262 setup`, or set LAKATOS_TEST262"
    return 2
  let binary : FilePath := (o.binary.map FilePath.mk).getD (defaultBinary ctx.root)
  unless ← binary.pathExists do
    ctx.err s!"tarski-test262: no evaluator at {binary}"
    ctx.err "run `lake build tarski` in thales/"
    return 2
  let lemma ← match ← ctx.lemma with
    | .ok bin => pure bin
    | .error msg =>
      ctx.err s!"tarski-test262: {msg}"
      return 2
  let scratch ← scratchDir "tarski-test262"
  let results ← try
      runSlices { checkout, binary, lemma, slices := o.slices, timeoutMs := o.timeout,
                  budgetMs := o.budget, jobs := ← o.jobs.getDM ctx.jobs, scratch,
                  err := ctx.err, progress := o.summary }
    finally
      try IO.FS.removeDirAll scratch catch _ => pure ()
  let counts := tabulate results
  ctx.out (renderTable counts)
  let details := renderDetails results (lists := !o.summary)
  unless details.isEmpty do ctx.out details
  if o.markdown.isSome || o.json.isSome then
    -- Labelled with the commit the checkout is really at; a mismatch with
    -- the pin is a warning, and the committed table is held to the pin by
    -- the suite that reads it.
    let commit ← headOf checkout
    let pinned := (← readPin (pinPath ctx.root)).commit
    if let some c := commit then
      if c != pinned then ctx.err s!"test262 checkout is at {c}, the pin is {pinned}"
    let summary := summarize results commit o.slices o.timeout
    if let some file := o.json then
      IO.FS.writeFile file (renderJson summary)
      ctx.out s!"wrote {file}"
    if let some file := o.markdown then
      IO.FS.writeFile file (renderMarkdown summary)
      ctx.out s!"wrote {file}"
  writeAndCheck o counts ctx

end Tarski.Test262

def main (args : List String) : IO UInt32 := do
  let some root ← Tarski.Test262.findPackageRoot (← IO.appPath)
    | do IO.eprintln "tarski-test262: no thales package here"; return 2
  Tarski.Test262.cli args { root, checkoutEnv := ← Tarski.Lemma.envVar "LAKATOS_TEST262" }
