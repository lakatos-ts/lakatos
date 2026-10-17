import Tarski.Decode
import Tarski.Eval
import Tarski.Format
import Tarski.Lemma

/-! The `tarski` binary: `tarski <file.ts>`, `tarski run <file.json>`, and
`tarski exec <file.json>`.

`tarski <file.ts>` runs one TypeScript file the way `node` runs a script:
lemma (`Tarski/Lemma.lean`) type checks the project and hands back the
program, and the program runs as `exec` runs one. It has its own exit
codes, below the document ones.

One ESTree document in — the JSON `lemma/schemas/tarski-estree.schema.json`
fixes, as the parser bridge produces it — one line out: the script's
completion value, or nothing when no statement produced one.

`exec` is what `tarski <file.ts>` runs, and its one difference from `run`
is that it prints **no** completion value: a program run for its effects
answers nothing a user asked for, and `node file.js` prints none either.
Everything else — the print log, the uncaught report, the exit codes — is
`run`'s exactly.

Exit codes:

* `0` — the script ran. Under `run`, its completion value, if any, is
  on stdout; under `exec` there is no such line.
* `1` — the script ended with an uncaught abrupt completion. `Uncaught `
  and the thrown value are on stderr: `<name>: <message>` for an Error
  object, the value's printed form otherwise.
* `2` — the input is not a script this binary can be handed: bad usage,
  an unreadable file, text that is not JSON, or a document outside the
  schema. The reason is on stderr.
* `3` — the script contains a node the evaluator does not know.
  `unsupported:` and the node kind are on stderr.

What the host's `print` was given is on stdout, one line per call, ahead
of the completion value and ahead of any report on stderr. The lines are
accumulated in the heap during the run (see `%PrintLog%` in
`Tarski/Realm.lean`) and written out once, so a run that ends abruptly
still shows what it printed before it did.

Divergence is not an exit code. A program that does not terminate is a
run this binary never returns from; the caller imposes a timeout and
reads the answer from that. -/

open Lean Tarski

/-- Write out what `print` was given during the run, one line each. -/
def printLog (h : Heap) : IO Unit :=
  h.printedLines.forM IO.println

/-- Run one decoded program and report it. `printCompletion` is the one
difference between `run` (`true`) and `exec` (`false`). -/
def report (printCompletion : Bool) (program : Program) : IO UInt32 :=
  match runScript program with
  | some (.ok none, h) => do
    printLog h
    pure 0
  | some (.ok (some v), h) => do
    printLog h
    if printCompletion then IO.println (formatValue v)
    pure 0
  | some (.error (.throw v), h) => do
    -- The heap the throw came out with is where the thrown object is, so
    -- the report is computed in it.
    printLog h
    IO.eprintln s!"Uncaught {describeThrown h v}"
    pure 1
  | some (.error _, h) => do
    printLog h
    -- A `return` outside any function, a `break` or `continue` outside
    -- any loop, or a jump to a label that is not on the stack. An engine
    -- refuses each as an early error, and early errors are outside the
    -- epic, so they are reported here as the abrupt completions they are.
    IO.eprintln "Uncaught: abrupt completion outside any loop, label, or function"
    pure 1
  | none => do
    -- The logical model of divergence. Compiled code loops instead of
    -- answering `none`, so nothing reaches this.
    IO.eprintln "tarski: evaluation produced no result"
    pure 2

/-- The body both subcommands share: read, parse, decode, report. -/
def execute (printCompletion : Bool) (path : String) : IO UInt32 := do
  let text ←
    try
      IO.FS.readFile path
    catch e =>
      IO.eprintln s!"tarski: {e}"
      return 2
  match Json.parse text with
  | .error msg =>
    IO.eprintln s!"tarski: {path}: {msg}"
    return 2
  | .ok json =>
    match decodeProgram json with
    | .error e@(.unsupported _) =>
      IO.eprintln e.message
      return 3
    | .error e@(.malformed _) =>
      IO.eprintln s!"tarski: {path}: {e.message}"
      return 2
    | .ok program => report printCompletion program

/-- `tarski run`: the completion value is a line of output. -/
def run (path : String) : IO UInt32 := execute true path

/-- `tarski exec`: it is not. -/
def exec (path : String) : IO UInt32 := execute false path

def usage : String :=
  "usage: tarski <file.ts>\n       tarski run|exec <file.json>"

def help : String := s!"{usage}

run one TypeScript file on the tarski evaluator. console.log goes to
stdout; an uncaught throw's class and message go to stderr with exit 1.

every run type checks the whole project first, through lemma, under the
project's own tsconfig.json with lakatos's required options (strict)
forced on top. a program that does not compile is refused with exit 2,
and so is a run without a tsconfig.json or a file the tsconfig's program
leaves out. tarski accepts exactly the programs thales accepts (the same
typecheck gate). a proof's model is checked against the evaluator per
declaration (the envelope's model field says whether, and why not), and
refute runs on Node, not on this evaluator.

lemma is @lakatos/lemma@{Lemma.version}, installed on first use into
~/.cache/lakatos/; LAKATOS_LEMMA=<dir> runs a built lemma checkout
instead. node and npm must be on PATH.

run and exec take one ESTree document instead (lemma's
schemas/tarski-estree.schema.json) and run it ungated: run prints the
completion value, exec does not. their exit codes are 0 ran, 1 uncaught,
2 bad input, 3 unsupported.

exit status of tarski <file.ts>: the program's own 0 or 1; 2 on a
refused program, a program the evaluator does not support, or a lemma
that cannot be had.

options:
  -h, --help  show this help"

/-- Why a refused document has no program, as `tarski <file.ts>` says it.
The gate's diagnostics come first, one `error:` line each. -/
def refusalLines (reason message : String) (diagnostics : Array Lemma.Diagnostic) :
    Array String :=
  diagnostics.map (s!"error: {·.format}") |>.push
    (if reason == "typecheck" then
      "tarski: the program does not type check under lakatos's required options"
    else s!"tarski: {message}")

/-- lemma's document for `file`, or why there is none. Exit 1 is the
program's uncaught throw, so no failure on the way to a program may
escape as an exception: every one is an answer here. -/
def checkTs (file : String) : IO (Except String (Array Lemma.Document)) := do
  try
    -- `lemma check` treats a name that is not a file as a pattern, and a
    -- pattern matching nothing is a refused command line.
    unless ← System.FilePath.pathExists file do
      return .error s!"{file} is not part of the program tsconfig.json describes, so it was not type checked"
    match ← Lemma.resolve with
    | .error msg => return .error msg
    | .ok bin => Lemma.check bin #[file]
  catch e => return .error (toString e)

/-- `tarski <file.ts>`: through lemma's gate, then `exec`. -/
def runTs (file : String) : IO UInt32 := do
  let docs ← match ← checkTs file with
    | .ok docs => pure docs
    | .error msg =>
      IO.eprintln s!"tarski: {msg}"
      return 2
  let some doc := docs[0]? | do
    IO.eprintln s!"tarski: lemma answered nothing for {file}"
    return 2
  match doc with
  | .refused _ _ reason message diagnostics .. =>
    for line in refusalLines reason message diagnostics do IO.eprintln line
    return 2
  | .program _ _ json _ =>
    let some programJson := (json.getObjVal? "program").toOption
      | do
        -- The document is lemma's own output, so this is a seam bug.
        IO.eprintln s!"tarski: lemma's document for {file} has no program"
        return 2
    match decodeProgram programJson with
    | .error (.unsupported kind) =>
      IO.eprintln s!"tarski: {file}: unsupported syntax: {kind}"
      return 2
    | .error e@(.malformed _) =>
      -- The document is lemma's own output, so this is a seam bug.
      IO.eprintln s!"tarski: lemma's program for {file} does not decode: {e.message}"
      return 2
    | .ok program => report false program

def main (args : List String) : IO UInt32 := do
  match args with
  | ["run", path] => run path
  | ["exec", path] => exec path
  | ["-h"] | ["--help"] =>
    IO.println help
    return 0
  | [file] =>
    if file.startsWith "-" then
      IO.eprintln usage
      return 2
    runTs file
  | _ =>
    IO.eprintln usage
    return 2
