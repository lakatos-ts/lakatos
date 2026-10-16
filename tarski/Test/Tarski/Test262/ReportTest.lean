import Tarski.Test262.Report

open Tarski.Test262
open Lean

def ran (directory name : String) (outcome : Outcome) : Result :=
  { path := s!"{directory}/{name}", directory, plan := .run none, outcome := some outcome }

def notRunAt (directory name : String) (reason : NotRunReason) : Result :=
  { path := s!"{directory}/{name}", directory, plan := .notRun reason }

def skippedAt (directory : String) (reason : SkipReason) : Result :=
  { path := s!"{directory}/skip.js", directory, plan := .skip reason }

-- tabulate: groups by directory, sorted, and omits skipped tests
#guard tabulate #[
    ran "test/b" "one.js" .pass,
    ran "test/a" "two.js" (.fail "Uncaught Test262Error: boom"),
    ran "test/a" "three.js" (.unsupported "ForOfStatement"),
    ran "test/a" "four.js" .timeout,
    ran "test/a" "five.js" (.harnessError "no such file"),
    notRunAt "test/a" "six.js" .async,
    { path := "test/intl402/seven.js", directory := "test/intl402", plan := .skip .intl402 }] ==
  #[("test/a", { fail := 1, unsupported := 1, timeout := 1, harnessError := 1, notRun := { async := 1 } }),
    ("test/b", { pass := 1 })]
-- tabulate: each not-run reason in its own column
#guard tabulate (NotRunReason.all.map fun r => notRunAt "test/x" s!"{r.name}.js" r) ==
  #[("test/x", { notRun := { noStrict := 1, raw := 1, async := 1, module := 1, budget := 1 } })]

-- rollUp: three components, every field summed
#guard rollUp #[
    ("test/language/statements/for", { pass := 1, fail := 2, unsupported := 3, timeout := 4, harnessError := 5,
                                       notRun := { noStrict := 6, raw := 7 } }),
    ("test/language/statements/if", { pass := 10, fail := 20, unsupported := 30, timeout := 40, harnessError := 50,
                                      notRun := { async := 8, module := 9, budget := 10 } })] ==
  #[("test/language/statements", { pass := 11, fail := 22, unsupported := 33, timeout := 44, harnessError := 55,
                                   notRun := { noStrict := 6, raw := 7, async := 8, module := 9, budget := 10 } })]
-- rollUp: the depth is an argument
#guard (rollUp #[("test/language/statements/for", { pass := 1 }), ("test/built-ins/Math/abs", { pass := 1 })] 2).map (·.1) ==
  #["test/built-ins", "test/language"]
-- rollUp: a shallower directory is its own key, and the keys sort
#guard (rollUp #[("test/language/expressions/addition", {}), ("test/harness", {}), ("test/built-ins/Math/abs", {})]).map (·.1) ==
  #["test/built-ins/Math", "test/harness", "test/language/expressions"]

-- renderTable: the issue's shape
#guard renderTable #[("test/harness", { unsupported := 99, notRun := { async := 17 } }),
                     ("test/language/expressions", { pass := 101, fail := 9 })] ==
  "directory                  pass  fail  unsupported  timeout  harness-error  not-run\n" ++
  "test/harness                  0     0           99        0              0       17\n" ++
  "test/language/expressions   101     9            0        0              0        0"
-- renderTable: the headers alone for an empty run
#guard renderTable #[] == "directory  pass  fail  unsupported  timeout  harness-error  not-run"

-- renderDetails: the reasons in the order first seen, the histogram, and the three lists
#guard renderDetails #[
    notRunAt "test/a" "one.js" .async, notRunAt "test/a" "two.js" .async, notRunAt "test/a" "three.js" .raw,
    { path := "test/a/four.js", directory := "test/a", plan := .skip .parseNegative },
    ran "test/a" "five.js" (.unsupported "ForOfStatement"),
    ran "test/a" "six.js" (.unsupported "TemplateExpression"),
    ran "test/a" "seven.js" (.unsupported "TemplateExpression"),
    ran "test/a" "eight.js" (.fail "Uncaught Test262Error: boom"),
    ran "test/a" "nine.js" (.harnessError "no harness file nope.js"),
    ran "test/a" "ten.js" .timeout,
    ran "test/a" "eleven.js" .pass] ==
  "not run:\n  async  2\n  raw  1\nskipped:\n  parse-negative  1\nunsupported:\n  TemplateExpression  2\n" ++
  "  ForOfStatement  1\nfailures:\n  test/a/eight.js  Uncaught Test262Error: boom\nharness errors:\n" ++
  "  test/a/nine.js  no harness file nope.js\ntimeouts:\n  test/a/ten.js"
-- renderDetails: a histogram tie breaks by name, whichever came first
#guard renderDetails #[ran "test/a" "one.js" (.unsupported "TemplateExpression"), ran "test/a" "two.js" (.unsupported "ForOfStatement")] ==
  "unsupported:\n  ForOfStatement  1\n  TemplateExpression  1"
#guard renderDetails #[ran "test/a" "one.js" (.unsupported "ForOfStatement"), ran "test/a" "two.js" (.unsupported "TemplateExpression")] ==
  "unsupported:\n  ForOfStatement  1\n  TemplateExpression  1"
-- renderDetails: nothing when everything passed
#guard renderDetails #[ran "test/a" "one.js" .pass] == ""
-- renderDetails: lists := false keeps the counts and drops the lists
#guard renderDetails (lists := false) #[
    notRunAt "test/a" "one.js" .budget,
    { path := "test/a/two.js", directory := "test/a", plan := .skip .intl402 },
    ran "test/a" "three.js" (.unsupported "SwitchStatement"),
    ran "test/a" "four.js" (.fail "Uncaught Test262Error: boom"),
    ran "test/a" "five.js" (.harnessError "no harness file nope.js"),
    ran "test/a" "six.js" .timeout] ==
  "not run:\n  budget  1\nskipped:\n  intl402  1\nunsupported:\n  SwitchStatement  1"

/-- One run of every class, across two depth-three groups. -/
def sample : Array Result := #[
  ran "test/built-ins/Math/abs" "one.js" .pass,
  ran "test/built-ins/Math/abs" "two.js" (.unsupported "SwitchStatement"),
  ran "test/built-ins/Math/cos" "three.js" (.fail "Uncaught Test262Error: boom"),
  ran "test/built-ins/Math/cos" "four.js" (.unsupported "SwitchStatement"),
  ran "test/language/statements/for" "five.js" .timeout,
  ran "test/language/statements/for" "six.js" (.harnessError "no harness file nope.js"),
  ran "test/language/statements/if" "seven.js" (.unsupported "ForStatement"),
  notRunAt "test/language/statements/if" "eight.js" .budget,
  notRunAt "test/language/statements/if" "nine.js" .async,
  skippedAt "test/intl402/Collator" .intl402,
  skippedAt "test/language/statements/if" .parseNegative]

def COMMIT : String := "419d3e0a2273ba01a3bfcbec423f2801425b8e93"

def summaryOf (results : Array Result) (commit : Option String) : Summary :=
  summarize results commit #["test/language", "test/built-ins", "test/intl402"] 10000

-- summarize: rolls up, totals, and copies what it was told
#guard (summaryOf sample (some COMMIT)).commit == some COMMIT
#guard (summaryOf sample (some COMMIT)).slices == #["test/language", "test/built-ins", "test/intl402"]
#guard (summaryOf sample (some COMMIT)).timeoutMs == 10000
#guard (summaryOf sample (some COMMIT)).directories == #[
  ("test/built-ins/Math", { pass := 1, fail := 1, unsupported := 2 }),
  ("test/language/statements", { unsupported := 1, timeout := 1, harnessError := 1, notRun := { async := 1, budget := 1 } })]
#guard (summaryOf sample (some COMMIT)).totals ==
  { pass := 1, fail := 1, unsupported := 3, timeout := 1, harnessError := 1, notRun := { async := 1, budget := 1 } }
-- summarize: every skip reason, zeros included, and the histogram in order
#guard (summaryOf sample (some COMMIT)).skipped == #[(.parseNegative, 1), (.resolutionNegative, 0), (.intl402, 1)]
#guard (summaryOf sample (some COMMIT)).unsupported == #[("SwitchStatement", 2), ("ForStatement", 1)]
-- summarize: a null commit passes through
#guard (summaryOf sample none).commit == none

-- renderMarkdown: the committed document's shape
#guard renderMarkdown (summaryOf sample (some COMMIT)) == "\n".intercalate [
  "# test262 results",
  "",
  "The evaluator run against test262 at `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, over `test/language`, `test/built-ins`, `test/intl402`, with a 10-second per-test timeout. Written by `sh scripts/test262-full.sh`; not edited by hand.",
  "",
  "## By directory",
  "",
  "| directory                | tests | pass | fail | unsupported | timeout | harness-error | not-run |",
  "| ------------------------ | ----: | ---: | ---: | ----------: | ------: | ------------: | ------: |",
  "| test/built-ins/Math      |     4 |    1 |    1 |           2 |       0 |             0 |       0 |",
  "| test/language/statements |     5 |    0 |    0 |           1 |       1 |             1 |       2 |",
  "| total                    |     9 |    1 |    1 |           3 |       1 |             1 |       2 |",
  "",
  "## Not run and skipped",
  "",
  "| kind                | tests | where             |",
  "| ------------------- | ----: | ----------------- |",
  "| noStrict            |     0 | not-run column    |",
  "| raw                 |     0 | not-run column    |",
  "| async               |     1 | not-run column    |",
  "| module              |     0 | not-run column    |",
  "| budget              |     1 | not-run column    |",
  "| parse-negative      |     1 | outside the table |",
  "| resolution-negative |     0 | outside the table |",
  "| intl402             |     1 | outside the table |",
  "",
  "## Unsupported",
  "",
  "| kind            | tests |",
  "| --------------- | ----: |",
  "| SwitchStatement |     2 |",
  "| ForStatement    |     1 |",
  ""]
-- renderMarkdown: an unknown commit is named as such
#guard ((renderMarkdown (summaryOf sample none)).splitOn "at an unknown commit, over").length == 2
-- renderMarkdown: no Unsupported table when nothing was refused
#guard ((renderMarkdown (summaryOf #[ran "test/a/b" "one.js" .pass] (some COMMIT))).splitOn "## Unsupported").length == 1
#guard ((renderMarkdown (summaryOf #[ran "test/a/b" "one.js" .pass] (some COMMIT))).splitOn "## Not run and skipped").length == 2
-- renderMarkdown: a directory wider than every header widens its column
#guard ((renderMarkdown (summaryOf #[ran "test/language/an-extremely-long-directory-name-indeed" "one.js" .pass] (some COMMIT))).splitOn
  "| test/language/an-extremely-long-directory-name-indeed |").length == 2
-- renderMarkdown: a pipe in a kind is escaped, and the escaped text is padded
#guard ((renderMarkdown (summaryOf #[ran "test/a/b" "one.js" (.unsupported "AssignmentExpression ||="),
                                     ran "test/a/b" "two.js" (.unsupported "BinaryExpression |")] (some COMMIT))).splitOn
  "| AssignmentExpression \\|\\|= |     1 |\n| BinaryExpression \\|        |     1 |").length == 2
#guard seconds 10000 == "10" && seconds 2500 == "2.5" && seconds 1 == "0.001" && seconds 1230 == "1.23"

-- renderJson: parses back to the summary's JSON, structurally
#guard Json.parse (renderJson (summaryOf sample (some COMMIT))) matches .ok _
#guard (Json.parse (renderJson (summaryOf sample (some COMMIT)))).toOption == some (summaryOf sample (some COMMIT)).toJson
-- renderJson: the shape the committed file's readers use
#guard ((summaryOf sample none).toJson.getObjValD "test262").getObjValD "commit" == Json.null
#guard (summaryOf sample (some COMMIT)).toJson.getObjValD "slices" ==
  Json.arr #["test/language", "test/built-ins", "test/intl402"]
#guard ((summaryOf sample (some COMMIT)).toJson.getObjValD "skipped").getObjValD "parse-negative" == (1 : Nat)

-- the expectations round-trip through --write's text
#guard (readExpectations (renderExpectations (summaryOf sample none).directories)).toOption ==
  some (summaryOf sample none).directories
#guard (readExpectations "{\"directories\": {\"test/a\": {\"pass\": 1}}}").toOption == none

-- diffExpectations
def actual : Table := #[("test/harness", { unsupported := 99, notRun := { async := 17 } })]
#guard diffExpectations actual #[("test/harness", { unsupported := 99, notRun := { async := 17 } })] == #[]
#guard diffExpectations actual #[("test/harness", { unsupported := 98, pass := 1, notRun := { async := 17 } })] ==
  #["test/harness: pass expected 1, got 0", "test/harness: unsupported expected 98, got 99"]
#guard diffExpectations actual #[("test/harness", { unsupported := 99, notRun := { async := 16 } })] ==
  #["test/harness: not-run async expected 16, got 17"]
-- a budget exhaustion is never silent
#guard diffExpectations #[("test/harness", { unsupported := 99, notRun := { async := 17, budget := 3 } })]
    #[("test/harness", { unsupported := 99, notRun := { async := 17 } })] ==
  #["test/harness: not-run budget expected 0, got 3"]
#guard diffExpectations actual #[] == #["test/harness: not in the expectations"]
#guard diffExpectations #[] #[("test/harness", {})] == #["test/harness: expected but not run"]
