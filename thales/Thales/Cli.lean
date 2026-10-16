import Tarski.Lemma

/-! The command line: `usage`, `help`, and the argument parse, which
mirrors the TypeScript bin's `parseArgs` (strict, positionals allowed,
one boolean `-h`/`--help`). -/

namespace Thales

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

inductive Command where
  | help
  | usageError
  | prove (patterns : Array String)
  | runArtifact (file : String)
deriving BEq, Repr

/-- Whether help was asked for and the positionals, or none on an unknown
option; `--` ends the options and a lone `-` is a positional. -/
def scanArgs : List String → Bool → Array String → Option (Bool × Array String)
  | [], h, ps => some (h, ps)
  | "--" :: rest, h, ps => some (h, ps ++ rest.toArray)
  | a :: rest, h, ps =>
    if a == "--help" then scanArgs rest true ps
    else if a.startsWith "--" then none
    -- A short group like `-hh` is `-h` repeated; any other letter is unknown.
    else if a.startsWith "-" && a.length > 1 then
      if a.toList.tail.all (· == 'h') then scanArgs rest true ps else none
    else scanArgs rest h (ps.push a)

/-- An unknown option outranks help wherever it sits, as with `parseArgs`. -/
def parseArgs (args : List String) : Command :=
  let (artifact, rest) := match args with
    | "run-artifact" :: rest => (true, rest)
    | _ => (false, args)
  match scanArgs rest false #[] with
  | none => .usageError
  | some (true, _) => .help
  | some (false, ps) =>
    if !artifact then .prove ps
    else if h : ps.size = 1 then .runArtifact ps[0]
    else .usageError

end Thales
