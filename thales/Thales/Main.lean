import Thales.Tool
-- The renderer imports these at runtime; importing them makes Lake build
-- their oleans beside the executable.
import ThalesDsl
import ThalesEmit

/-! The `thales` executable: `thales [files-or-globs...]`.

Every `@ensures` annotation in the named files, or in the files
tsconfig.json compiles when none are named, goes through lemma's gate and
emitter, its obligation is rendered as a Lean artifact under
`.lakatos/<run>/thales/`, and Lean attempts it. One JSON envelope out on
stdout (`spec/envelope.schema.json`), notes on stderr. -/

open Lean Thales

def usage : String := "usage: thales [files-or-globs...]"

def help : String := s!"{usage}

emit Lean for each file and attempt a proof per @ensures annotation, then
print a JSON report to stdout. artifacts land in .lakatos/<run>/thales/.
needs a lakatos checkout with the Lean toolchain.

when no files are given, thales discovers your sources: the files that
tsconfig.json would compile. declaration files (.d.ts) are skipped unless a
pattern names them.

every run type checks the whole project first, under the project's own
tsconfig.json with lakatos's required options (strict) forced on top. a
program that does not compile is refused (annotations report InputError,
exit 2); a run without a tsconfig.json is refused the same way, and so is
any named file the tsconfig's program leaves out.

lemma is @lakatos/lemma@{Tarski.Lemma.version}, installed on first use into
~/.cache/lakatos/; LAKATOS_LEMMA=<dir> runs a built lemma checkout
instead. node and npm must be on PATH.

exit status: 0 when nothing was refuted, 1 when something was, 2 on bad
input, an engine failure, or an interrupted run.

options:
  -h, --help  show this help"

/-- The command line as Node's `parseArgs` read it for the TypeScript
tool: `-h`/`--help` and positionals, with `--` ending the options and a
bare `-` a positional; any other option is a usage error, whatever else
is there. `none` is a usage error; `some (help, patterns)` otherwise. -/
def parseArgs (args : List String) : Option (Bool × Array String) :=
  go args false #[]
where
  go : List String → Bool → Array String → Option (Bool × Array String)
    | [], help, ps => some (help, ps)
    | "--" :: rest, help, ps => some (help, ps ++ rest.toArray)
    | a :: rest, help, ps =>
      if a == "-h" || a == "--help" then go rest true ps
      else if a.startsWith "-" && a != "-" then none
      else go rest help (ps.push a)

/-- `unsafe` for the one thing the renderer needs from it: the imported
modules' initializers, the parser and printer tables among them, run only
when this process allows it. -/
unsafe def main (args : List String) : IO UInt32 := do
  let some (help?, patterns) := parseArgs args
    | IO.eprintln usage
      return 2
  if help? then
    IO.println help
    return 0
  enableInitializersExecution
  -- The executable runs from the package it was built in:
  -- `.lake/build/bin/thales`.
  let engineRoot ← match (← IO.appPath).parent with
    | some dir => findEngineRoot dir
    | none => pure none
  prove patterns engineRoot
