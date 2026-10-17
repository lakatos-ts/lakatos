import Lean.Data.Json
import Std.Data.HashMap
import Tarski.Test262.Plan
import Tarski.Test262.Classify

/-! The table, the details under it, the committed files, and the diff
against the expectations.

One row per directory: the unit a slice is named by and the unit the
expectations pin. Skipped tests are in no row: what `intl402` and the
parse-phase negatives amount to is a property of the pinned commit, not of
the evaluator. -/

namespace Tarski.Test262

open Lean

/-- The not-run column, by reason. -/
structure NotRunCounts where
  noStrict : Nat := 0
  raw : Nat := 0
  async : Nat := 0
  module : Nat := 0
  budget : Nat := 0
deriving Repr, BEq, Inhabited

def NotRunCounts.get (c : NotRunCounts) : NotRunReason → Nat
  | .noStrict => c.noStrict | .raw => c.raw | .async => c.async
  | .module => c.module | .budget => c.budget

def NotRunCounts.bump (c : NotRunCounts) : NotRunReason → NotRunCounts
  | .noStrict => { c with noStrict := c.noStrict + 1 }
  | .raw => { c with raw := c.raw + 1 }
  | .async => { c with async := c.async + 1 }
  | .module => { c with module := c.module + 1 }
  | .budget => { c with budget := c.budget + 1 }

def NotRunCounts.add (a b : NotRunCounts) : NotRunCounts :=
  { noStrict := a.noStrict + b.noStrict, raw := a.raw + b.raw, async := a.async + b.async,
    module := a.module + b.module, budget := a.budget + b.budget }

/-- The reasons summed: the single column the table shows. -/
def NotRunCounts.total (c : NotRunCounts) : Nat :=
  NotRunReason.all.foldl (fun sum r => sum + c.get r) 0

/-- The counts one directory's row carries. -/
structure DirectoryCounts where
  pass : Nat := 0
  fail : Nat := 0
  unsupported : Nat := 0
  timeout : Nat := 0
  harnessError : Nat := 0
  notRun : NotRunCounts := {}
deriving Repr, BEq, Inhabited

/-- `a + b`, field by field, every not-run reason included. -/
def DirectoryCounts.add (a b : DirectoryCounts) : DirectoryCounts :=
  { pass := a.pass + b.pass, fail := a.fail + b.fail, unsupported := a.unsupported + b.unsupported,
    timeout := a.timeout + b.timeout, harnessError := a.harnessError + b.harnessError,
    notRun := a.notRun.add b.notRun }

/-- Every count summed: the denominator the row answers for. -/
def DirectoryCounts.total (c : DirectoryCounts) : Nat :=
  c.pass + c.fail + c.unsupported + c.timeout + c.harnessError + c.notRun.total

/-- Rows by directory, sorted by directory. -/
abbrev Table := Array (String × DirectoryCounts)

/-- What became of one test: a `Plan` with its assembled text dropped, so
a whole-suite run does not hold every source. -/
inductive Disposition where
  | run (negative : Option String)
  | notRun (reason : NotRunReason)
  | skip (reason : SkipReason)
deriving Repr, BEq, Inhabited

/-- One test, planned and (unless skipped or not run) run. -/
structure Result where
  path : String
  directory : String
  plan : Disposition
  outcome : Option Outcome := none
deriving Repr, BEq, Inhabited

private def sortTable (rows : Array (String × DirectoryCounts)) : Table :=
  rows.qsort (·.1 < ·.1)

/-- The results as one row per directory, sorted. A directory whose every
test was skipped has no row. -/
def tabulate (results : Array Result) : Table := Id.run do
  let mut rows : Std.HashMap String DirectoryCounts := {}
  for r in results do
    let row := rows.getD r.directory {}
    match r.plan with
    | .skip _ => continue
    | .notRun reason => rows := rows.insert r.directory { row with notRun := row.notRun.bump reason }
    | .run _ =>
      let row := match r.outcome with
        | some .pass => { row with pass := row.pass + 1 }
        | some (.fail _) => { row with fail := row.fail + 1 }
        | some (.unsupported _) => { row with unsupported := row.unsupported + 1 }
        | some .timeout => { row with timeout := row.timeout + 1 }
        -- A planned run with no outcome cannot happen; it lands with
        -- `harness-error` rather than inventing a seventh class.
        | some (.harnessError _) | none => { row with harnessError := row.harnessError + 1 }
      rows := rows.insert r.directory row
  return sortTable rows.toArray

/-- The first `depth` components of a directory; a shorter one is its own key. -/
def groupKey (directory : String) (depth : Nat := 3) : String :=
  "/".intercalate ((directory.splitOn "/").take depth)

/-- A leaf table re-keyed to `depth` components and summed, sorted: the
granularity of the committed results, not of `expected.json`. -/
def rollUp (counts : Table) (depth : Nat := 3) : Table := Id.run do
  let mut rows : Std.HashMap String DirectoryCounts := {}
  for (directory, row) in counts do
    let key := groupKey directory depth
    rows := rows.insert key ((rows.getD key {}).add row)
  return sortTable rows.toArray

/-- The unsupported kinds, commonest first, ties by name. -/
def histogram (results : Array Result) : Array (String × Nat) := Id.run do
  let mut kinds : Std.HashMap String Nat := {}
  for r in results do
    if let (.run _, some (.unsupported kind)) := (r.plan, r.outcome) then
      kinds := kinds.insert kind (kinds.getD kind 0 + 1)
  return kinds.toArray.qsort fun (a, m) (b, n) => m > n || (m == n && a < b)

/-- Everything the committed results files say: nothing that differs
between two runs of one binary over one pin. -/
structure Summary where
  commit : Option String
  slices : Array String
  timeoutMs : Nat
  directories : Table
  totals : DirectoryCounts
  /-- Every reason, zeros included, in `SkipReason.all` order. -/
  skipped : Array (SkipReason × Nat)
  unsupported : Array (String × Nat)
deriving Repr, BEq, Inhabited

def summarize (results : Array Result) (commit : Option String) (slices : Array String)
    (timeoutMs : Nat) : Summary :=
  let directories := rollUp (tabulate results)
  let skipped := SkipReason.all.map fun reason =>
    (reason, results.foldl (fun n r => if r.plan == .skip reason then n + 1 else n) 0)
  { commit, slices, timeoutMs, directories,
    totals := directories.foldl (fun t (_, row) => t.add row) {},
    skipped, unsupported := histogram results }

/-- `s` padded with spaces to `width` on the right. -/
def padEnd (s : String) (width : Nat) : String := s.pushn ' ' (width - s.length)

/-- `s` padded with spaces to `width` on the left. -/
def padStart (s : String) (width : Nat) : String := ("".pushn ' ' (width - s.length)) ++ s

/-- `String.prototype.trimEnd`. -/
def trimEnd (s : String) : String := String.ofList (s.toList.reverse.dropWhile jsSpace).reverse

private def tableHeaders : Array String :=
  #["directory", "pass", "fail", "unsupported", "timeout", "harness-error", "not-run"]

/-- The per-directory table, counts right-aligned under their headers. -/
def renderTable (counts : Table) : String := Id.run do
  let rows := counts.map fun (directory, c) =>
    #[directory, toString c.pass, toString c.fail, toString c.unsupported, toString c.timeout,
      toString c.harnessError, toString c.notRun.total]
  let all := #[tableHeaders] ++ rows
  let widths := (List.range tableHeaders.size).toArray.map fun col =>
    all.foldl (fun w row => max w (row[col]?.getD "").length) 0
  let line (cells : Array String) : String :=
    trimEnd ("  ".intercalate (cells.toList.zipIdx.map fun (cell, col) =>
      if col == 0 then padEnd cell (widths[col]?.getD 0) else padStart cell (widths[col]?.getD 0)))
  return "\n".intercalate (all.map line).toList

/-- `key`'s count bumped, keys kept in the order first seen. -/
private def bump (counter : Array (String × Nat)) (key : String) : Array (String × Nat) :=
  match counter.findIdx? (·.1 == key) with
  | some i => counter.modify i fun (k, n) => (k, n + 1)
  | none => counter.push (key, 1)

/-- `not run:`, `skipped:`, the unsupported histogram, and the three lists;
`lists := false` keeps the counts and drops the lists. -/
def renderDetails (results : Array Result) (lists : Bool := true) : String := Id.run do
  let mut notRun : Array (String × Nat) := #[]
  let mut skipped : Array (String × Nat) := #[]
  let mut failures : Array String := #[]
  let mut harnessErrors : Array String := #[]
  let mut timeouts : Array String := #[]
  for r in results do
    match r.plan, r.outcome with
    | .skip reason, _ => skipped := bump skipped reason.name
    | .notRun reason, _ => notRun := bump notRun reason.name
    | .run _, some (.fail detail) => failures := failures.push s!"  {r.path}  {detail}"
    | .run _, some (.harnessError detail) => harnessErrors := harnessErrors.push s!"  {r.path}  {detail}"
    | .run _, some .timeout => timeouts := timeouts.push s!"  {r.path}"
    | _, _ => pure ()
  let mut sections : Array String := #[]
  let counted (title : String) (counter : Array (String × Nat)) : Option String :=
    if counter.isEmpty then none
    else some ("\n".intercalate (title :: (counter.map fun (k, n) => s!"  {k}  {n}").toList))
  for s in [counted "not run:" notRun, counted "skipped:" skipped,
            counted "unsupported:" (histogram results)] do
    if let some s := s then sections := sections.push s
  if lists then
    for (title, lines) in [("failures:", failures), ("harness errors:", harnessErrors),
                           ("timeouts:", timeouts)] do
      unless lines.isEmpty do sections := sections.push ("\n".intercalate (title :: lines.toList))
  return "\n".intercalate sections.toList

/-- A GitHub-flavored table padded the way prettier pads one. -/
def markdownTable (header : Array String) (right : Array Bool) (unescaped : Array (Array String)) :
    String := Id.run do
  -- A `|` inside a cell would open a new one.
  let rows := unescaped.map (·.map (·.replace "|" "\\|"))
  -- Three is prettier's floor: a rule needs `---` or `--:`.
  let mut widths := header.map fun h => max 3 h.length
  for row in rows do
    for h : col in [0:row.size] do
      widths := widths.modify col (max · row[col].length)
  let isRight (col : Nat) := right[col]?.getD false
  let cells (row : Array String) : String :=
    "| " ++ " | ".intercalate (row.toList.zipIdx.map fun (cell, col) =>
      if isRight col then padStart cell (widths[col]?.getD 0) else padEnd cell (widths[col]?.getD 0)) ++ " |"
  let rule := "| " ++ " | ".intercalate (widths.toList.zipIdx.map fun (w, col) =>
    if isRight col then "".pushn '-' (w - 1) ++ ":" else "".pushn '-' w) ++ " |"
  return "\n".intercalate (#[cells header, rule] ++ rows.map cells).toList

/-- Milliseconds as JavaScript prints `ms / 1000`. -/
def seconds (ms : Nat) : String :=
  let frac := ms % 1000
  if frac == 0 then toString (ms / 1000)
  else
    let padded := "".pushn '0' (3 - (toString frac).length) ++ toString frac
    let digits := String.ofList (padded.toList.reverse.dropWhile (· == '0')).reverse
    s!"{ms / 1000}.{digits}"

private def markdownHeaders : Array String :=
  #["directory", "tests", "pass", "fail", "unsupported", "timeout", "harness-error", "not-run"]

private def markdownRow (directory : String) (c : DirectoryCounts) : Array String :=
  #[directory, toString c.total, toString c.pass, toString c.fail, toString c.unsupported,
    toString c.timeout, toString c.harnessError, toString c.notRun.total]

/-- The document `test262/results.md`. -/
def renderMarkdown (s : Summary) : String :=
  let commit := match s.commit with
    | none => "an unknown commit"
    | some c => s!"`{c}`"
  let slices := ", ".intercalate (s.slices.map (s!"`{·}`")).toList
  let sections := #[
    "# test262 results",
    s!"The evaluator run against test262 at {commit}, over {slices}, with a {seconds s.timeoutMs}-second per-test timeout. Written by `sh scripts/test262-full.sh`; not edited by hand.",
    "## By directory",
    markdownTable markdownHeaders (markdownHeaders.mapIdx fun i _ => i > 0)
      (s.directories.map (fun (d, c) => markdownRow d c) |>.push (markdownRow "total" s.totals)),
    "## Not run and skipped",
    markdownTable #["kind", "tests", "where"] #[false, true, false]
      ((NotRunReason.all.map fun r => #[r.name, toString (s.totals.notRun.get r), "not-run column"]) ++
       (s.skipped.map fun (r, n) => #[r.name, toString n, "outside the table"]))]
  let sections := if s.unsupported.isEmpty then sections else sections ++ #[
    "## Unsupported",
    markdownTable #["kind", "tests"] #[false, true] (s.unsupported.map fun (k, n) => #[k, toString n])]
  "\n\n".intercalate sections.toList ++ "\n"

def NotRunCounts.toJson (c : NotRunCounts) : Json :=
  Json.mkObj (NotRunReason.all.map (fun r => (r.name, (c.get r : Json)))).toList

def DirectoryCounts.toJson (c : DirectoryCounts) : Json :=
  Json.mkObj [("pass", c.pass), ("fail", c.fail), ("unsupported", c.unsupported),
    ("timeout", c.timeout), ("harnessError", c.harnessError), ("notRun", c.notRun.toJson)]

def DirectoryCounts.fromJson? (j : Json) : Except String DirectoryCounts := do
  let n ← j.getObjVal? "notRun"
  return { pass := ← j.getObjValAs? Nat "pass", fail := ← j.getObjValAs? Nat "fail",
           unsupported := ← j.getObjValAs? Nat "unsupported", timeout := ← j.getObjValAs? Nat "timeout",
           harnessError := ← j.getObjValAs? Nat "harnessError",
           notRun := { noStrict := ← n.getObjValAs? Nat "noStrict", raw := ← n.getObjValAs? Nat "raw",
                       async := ← n.getObjValAs? Nat "async", module := ← n.getObjValAs? Nat "module",
                       budget := ← n.getObjValAs? Nat "budget" } }

def tableToJson (t : Table) : Json :=
  Json.mkObj (t.map fun (d, c) => (d, c.toJson)).toList

def tableFromJson? (j : Json) : Except String Table := do
  let rows ← j.getObj?
  let mut out := #[]
  for (d, c) in rows.toList do
    out := out.push (d, ← (DirectoryCounts.fromJson? c).mapError (s!"{d}: {·}"))
  return sortTable out

def Summary.toJson (s : Summary) : Json :=
  Json.mkObj [
    ("test262", Json.mkObj [("commit", match s.commit with | some c => Json.str c | none => Json.null)]),
    ("slices", Json.arr (s.slices.map Json.str)),
    ("timeoutMs", s.timeoutMs),
    ("directories", tableToJson s.directories),
    ("totals", s.totals.toJson),
    ("skipped", Json.mkObj (s.skipped.map fun (r, n) => (r.name, (n : Json))).toList),
    ("unsupported", Json.mkObj (s.unsupported.map fun (k, n) => (k, (n : Json))).toList)]

/-- The document `test262/results.json`. -/
def renderJson (s : Summary) : String := s.toJson.pretty ++ "\n"

/-- What `--write` writes and `--check` reads. -/
def renderExpectations (t : Table) : String :=
  (Json.mkObj [("directories", tableToJson t)]).pretty ++ "\n"

def readExpectations (text : String) : Except String Table := do
  tableFromJson? (← (← Json.parse text).getObjVal? "directories")

/-- How the actual counts differ from the expected: a line per directory
missing from either side and per differing count. Empty when they agree. -/
def diffExpectations (actual expected : Table) : Array String := Id.run do
  let get (t : Table) (d : String) := (t.find? (·.1 == d)).map (·.2)
  let directories := (actual.map (·.1) ++ expected.map (·.1)).qsort (· < ·) |>.toList.eraseDups
  let mut lines := #[]
  for d in directories do
    match get actual d, get expected d with
    | _, none => lines := lines.push s!"{d}: not in the expectations"
    | none, _ => lines := lines.push s!"{d}: expected but not run"
    | some got, some want =>
      let fields := #[("pass", got.pass, want.pass), ("fail", got.fail, want.fail),
        ("unsupported", got.unsupported, want.unsupported), ("timeout", got.timeout, want.timeout),
        ("harness-error", got.harnessError, want.harnessError)] ++
        NotRunReason.all.map fun r => (s!"not-run {r.name}", got.notRun.get r, want.notRun.get r)
      for (field, g, w) in fields do
        if g != w then lines := lines.push s!"{d}: {field} expected {w}, got {g}"
  return lines

end Tarski.Test262
