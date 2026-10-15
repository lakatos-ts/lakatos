import Thales.Version
import Tarski.Lemma

open Thales

def usage : String := "usage: thales [files-or-globs...]"

def help : String := s!"{usage}

emit Lean for each file and attempt a proof per @ensures annotation, then
print a JSON report to stdout. artifacts land in .lakatos/<run>/thales/.
needs a lakatos checkout with the Lean toolchain, and node and npm on
PATH for lemma.

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
instead.

exit status: 0 when nothing was refuted, 1 when something was, 2 on bad
input, an engine failure, or an interrupted run.

options:
  -h, --help  show this help

for the check scripts:
  thales run-artifact <file.lean>  run one artifact under the prove budget
                                   and print the parsed verdict channel"

def main (args : List String) : IO UInt32 := do
  match args with
  | ["-h"] | ["--help"] => IO.println help; return 0
  | _ =>
    if args.any (·.startsWith "-") then IO.eprintln usage; return 2
    IO.eprintln "thales: not yet"
    return 2
