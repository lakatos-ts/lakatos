import Tarski.Test262.Frontmatter

/-! What to do with one test file: run this text, file it as not run, or
skip it entirely.

INTERPRETING.md fixes the assembly: `sta.js` and `assert.js`, then the
file's `includes` in order, then the test, all one script with
`"use strict";` at the top. A `raw` test runs exactly as written.

Strict mode only, so `noStrict` is not run, and neither is a `raw` test
whose text does not start strict; `async` needs the job queue and `module`
needs modules. Parse- and resolution-phase negatives are not scored (the
parser is TypeScript's), and neither is `intl402`. -/

namespace Tarski.Test262

open System (FilePath)

/-- Why a test was counted but not run. No plan produces `budget`: the
overall budget ran out before the test's turn. -/
inductive NotRunReason where
  | noStrict | raw | async | module | budget
deriving Repr, BEq, Inhabited

/-- Every not-run reason, in the order the rows are written. -/
def NotRunReason.all : Array NotRunReason := #[.noStrict, .raw, .async, .module, .budget]

def NotRunReason.name : NotRunReason → String
  | .noStrict => "noStrict" | .raw => "raw" | .async => "async"
  | .module => "module" | .budget => "budget"

/-- Why a test is outside the table entirely. -/
inductive SkipReason where
  | intl402 | parseNegative | resolutionNegative
deriving Repr, BEq, Inhabited

/-- Every skip reason, in the order the rows are written. -/
def SkipReason.all : Array SkipReason := #[.parseNegative, .resolutionNegative, .intl402]

def SkipReason.name : SkipReason → String
  | .intl402 => "intl402" | .parseNegative => "parse-negative"
  | .resolutionNegative => "resolution-negative"

/-- What the runner does with one test. `negative` is a runtime-phase
negative's class. -/
inductive Plan where
  | run (source : String) (negative : Option String)
  | notRun (reason : NotRunReason)
  | skip (reason : SkipReason)
deriving Repr, BEq, Inhabited

/-- The two preludes every non-`raw` test gets, in this order. -/
def preludes : List String := ["sta.js", "assert.js"]

/-- Leading white space, line comments, and block comments. -/
partial def skipTrivia : List Char → List Char
  | c :: rest => if jsSpace c then skipTrivia rest else
    match c, rest with
    | '/', '/' :: body =>
      -- `//[^\n]*\n`: a line comment counts only with its newline.
      match body.dropWhile (· != '\n') with
      | '\n' :: after => skipTrivia after
      | _ => c :: rest
    | '/', '*' :: body => closeBlock body (c :: rest)
    | _, _ => c :: rest
  | [] => []
where
  /-- After `/*`: past the first `*/`, or `start` when there is none. -/
  closeBlock : List Char → List Char → List Char
    | '*' :: '/' :: after, _ => skipTrivia after
    | _ :: more, start => closeBlock more start
    | [], start => start

/-- Whether the text's first token is a `"use strict"` directive. -/
def startsStrict (source : String) : Bool :=
  let cs := skipTrivia source.toList
  let after (directive : String) : Option (List Char) :=
    if (String.ofList cs).startsWith directive then some (cs.drop directive.length) else none
  match after "\"use strict\"" <|> after "'use strict'" with
  | some rest => (rest.dropWhile jsSpace).head? == some ';'
  | none => false

/-- The test at `relPath` (relative to the test262 root, `/`-separated),
whose text is `source`. `readHarness` reads one file of the checkout's
`harness/`, none when it is not there; a missing include is the error. -/
def planTest (relPath source : String) (readHarness : String → IO (Option String)) :
    IO (Except String Plan) := do
  -- A test can be several of these at once; the first explains it best.
  if relPath.startsWith "test/intl402/" then return .ok (.skip .intl402)
  let front := parseFrontMatter source
  let negative := front.negative.map (·.type)
  match front.negative with
  | some { phase := "parse", .. } => return .ok (.skip .parseNegative)
  | some { phase := "resolution", .. } => return .ok (.skip .resolutionNegative)
  | _ => pure ()
  if front.flags.contains "module" then return .ok (.notRun .module)
  if front.flags.contains "raw" then
    -- No harness and no modification: a raw test not already strict cannot run here.
    if !startsStrict source then return .ok (.notRun .raw)
    return .ok (.run source negative)
  if front.flags.contains "noStrict" then return .ok (.notRun .noStrict)
  if front.flags.contains "async" then return .ok (.notRun .async)
  -- `onlyStrict` and the unflagged default are the same run here.
  let mut parts := #["\"use strict\";"]
  for name in preludes ++ front.includes.toList do
    match ← readHarness name with
    | some text => parts := parts.push text
    | none => return .error s!"no harness file {name}"
  return .ok (.run ("\n".intercalate (parts.push source).toList) negative)

/-- A `.js` file that is a test rather than a module fixture. -/
def isTest (name : String) : Bool :=
  name.endsWith ".js" && !name.endsWith "_FIXTURE.js"

/-- A slice as `path.relative` spells it: no empty or `.` components. -/
def normalizeSlice (slice : String) : String :=
  "/".intercalate ((slice.splitOn "/").filter fun c => c != "" && c != ".")

/-- Every test under each slice, sorted, as `/`-separated paths relative to
the test262 root. A slice is a directory or a single file; one that is
neither is an error. -/
def listTests (root : FilePath) (slices : Array String) : IO (Array String) := do
  let mut out := #[]
  for slice in slices do
    let rel := normalizeSlice slice
    let absolute := root / rel
    if ← absolute.isDir then
      let prefix_ := s!"{absolute}/"
      for p in ← absolute.walkDir do
        if ← p.isDir then continue
        let some name := p.fileName | continue
        if isTest name then
          out := out.push s!"{rel}/{(toString p).drop prefix_.length}"
    else if ← absolute.pathExists then
      if isTest (absolute.fileName.getD "") then out := out.push rel
    else
      throw (IO.userError s!"no slice {slice} in {root}")
  return out.qsort (· < ·)

/-- A test's directory: its path less the last component, `.` at the root. -/
def directoryOf (relPath : String) : String :=
  match (relPath.splitOn "/").dropLast with
  | [] => "."
  | parts => "/".intercalate parts

end Tarski.Test262
