import Thales.Admit
import Thales.Plan

open Lean Thales Tarski

-- `mirrorPath`: the cwd-relative path under the run's root, with the
-- suffix on the whole name; a file outside the current directory has no
-- place there.
#guard (mirrorPath "/p" "src/a.ts" ".lakatos/r/thales" ".json").toOption
  == some ((".lakatos/r/thales" : System.FilePath) / "src/a.ts.json")
#guard (mirrorPath "/p" "/p/src/./x/../a.ts" ".lakatos/r/thales" ".lean").toOption
  == some ((".lakatos/r/thales" : System.FilePath) / "src/a.ts.lean")
#guard (mirrorPath "/p" "../q/a.ts" "o" ".json").toOption.isNone
#guard (mirrorPath "/p" "/elsewhere/a.ts" "o" ".json").toOption.isNone
#guard (mirrorPath "/p" "/p" "o" ".json").toOption.isNone

def ann (fn : String) (o : Lemma.Outcome) : Lemma.Annotation :=
  { function := fn, property := "p", line := 1, outcome := o }

def program (file : String) (as : Array Lemma.Annotation) : Lemma.Document :=
  .program file true Json.null as

def refused (file reason message : String) (as : Array Lemma.Annotation)
    (diagnostics : Array Lemma.Diagnostic := #[]) : Lemma.Document :=
  .refused file true reason message diagnostics Json.null as

/-- `admit`, with the notes it printed. -/
def admitted (docs : Array Lemma.Document) (discovered := false) :
    IO (Admission × Array String) := do
  let notes ← IO.mkRef #[]
  let a ← admit docs discovered fun n => notes.modify (·.push n.render)
  return (a, ← notes.get)

def describe : Admission → String
  | .refused rs => s!"refused {rs.map fun (i, e) => s!"{i.file}:{i.function}={e}"}"
  | .admitted ds rs => s!"admitted {ds.map (·.file)} {rs.map fun (i, e) => s!"{i.file}:{i.function}={e}"}"
  | .failed m => s!"failed {m}"

def expectAdmit (docs : Array Lemma.Document) (discovered : Bool) (want : String)
    (notes : Array String) : IO Unit := do
  let (a, got) ← admitted docs discovered
  unless describe a == want && got == notes do
    throw (IO.userError s!"got {describe a} with {got}")

-- No tsconfig.json: every file's gate refusals, then every file's
-- extraction ones; only the extraction ones are echoed.
#eval expectAdmit
  #[refused "a.ts" "no-tsconfig" "m" #[ann "f" (.refused "gate" "G"), ann "x" (.refused "extraction" "a.ts:3: dup")]
    , refused "b.ts" "no-tsconfig" "m" #[ann "g" (.refused "gate" "G")]]
  true
  "refused #[a.ts:f=G, b.ts:g=G, a.ts:x=a.ts:3: dup]"
  #["thales: no files given; discovered 2 file(s) via tsconfig.json", "error: a.ts:3: dup",
    "thales: no tsconfig.json; reporting 3 annotations as InputError"]

-- A program that does not type check: the diagnostics first.
#eval expectAdmit
  #[refused "a.ts" "typecheck" "m" #[ann "f" (.refused "gate" "G")]
      #[{ file := some "b.ts", line := some 1, code := 2322, message := "no" }]]
  false
  "refused #[a.ts:f=G]"
  #["error: b.ts:1: TS2322: no",
    "thales: the program does not type check under lakatos's required options; reporting 1 annotation as InputError"]

-- A file outside the program is refused alone, beside the admitted ones
-- and their typing refusals.
#eval expectAdmit
  #[program "a.ts" #[ann "f" .tried, ann "t" (.refused "typing" "a.ts:9: bad atom")],
    refused "out/b.ts" "outside-program" "out/b.ts is not part of the program"
      #[ann "g" (.refused "gate" "G"), ann "y" (.refused "extraction" "out/b.ts:2: dup")]]
  false
  "admitted #[a.ts] #[out/b.ts:g=G, out/b.ts:y=out/b.ts:2: dup, a.ts:t=a.ts:9: bad atom]"
  #["error: out/b.ts is not part of the program", "error: out/b.ts:2: dup", "error: a.ts:9: bad atom"]

-- A formula Lemma cannot read stops the run, after the outside notes.
#eval expectAdmit
  #[refused "out/b.ts" "outside-program" "outside" #[],
    refused "a.ts" "annotation" "a.ts:1: @ensures{p}: unexpected token" #[]]
  false
  "failed a.ts:1: @ensures{p}: unexpected token"
  #["error: outside"]
