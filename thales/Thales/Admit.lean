import Tarski.Lemma
import Thales.Envelope

/-! Admission: lemma's documents as the tool's verdict on its command line.

`lemma check` answers every file with a document saying what the gate
made of it and what became of each `@ensures`. This reads them the way
the TypeScript tool's `admit` decided, note for note: a project without
a tsconfig.json, or one that does not type check, refuses the whole run;
a named file the program leaves out is refused alone; an annotation the
gate's formula typing refused is an input error beside the rest. -/

namespace Thales

open Lean Tarski

/-- A stderr line: `error: <text>`, or `thales: <text>`. -/
inductive Note where
  | error (text : String)
  | info (text : String)
  deriving DecidableEq, Repr

def Note.render : Note → String
  | .error t => s!"error: {t}"
  | .info t => s!"thales: {t}"

/-- An annotation refused as bad input, with its diagnostic. -/
abbrev Refusal := Identity × String

/-- The tool's verdict on its command line. -/
inductive Admission where
  /-- Nothing runs: every annotation is reported InputError, exit 2. -/
  | refused (refusals : Array Refusal)
  /-- `docs` go on to the engine; `refusals` are reported beside them. -/
  | admitted (docs : Array Lemma.Document) (refusals : Array Refusal)
  /-- Bad input that is no annotation's: `error: <message>`, exit 2, and
  no envelope. -/
  | failed (message : String)

/-- `n annotation(s)`. -/
def annotations (n : Nat) : String := s!"{n} annotation{if n == 1 then "" else "s"}"

private def identity (d : Lemma.Document) (a : Lemma.Annotation) : Identity :=
  ⟨d.file, a.function, a.property⟩

/-- The document's annotations refused for `cause`, as refusals. -/
def refusedFor (cause : String) (d : Lemma.Document) : Array Refusal :=
  d.annotations.filterMap fun a =>
    match a.outcome with
    | .refused c e => if c == cause then some (identity d a, e) else none
    | _ => none

private def reason : Lemma.Document → Option String
  | .refused _ _ r .. => some r
  | .program .. => none

/-- Decide on `docs`, `lemma check`'s answer for the command line, whose
patterns were `discovered` from tsconfig.json when none were given. Notes
go to `say` in the order the TypeScript tool printed them. -/
def admit (docs : Array Lemma.Document) (discovered : Bool) (say : Note → IO Unit) :
    IO Admission := do
  if discovered then
    say (.info s!"no files given; discovered {docs.size} file(s) via tsconfig.json")
  let whole (preamble : Array Note) (why : String) : IO Admission := do
    -- Every file's gate refusals, then every file's extraction ones.
    let refusals := docs.flatMap (refusedFor "gate") ++ docs.flatMap (refusedFor "extraction")
    preamble.forM say
    (docs.flatMap (refusedFor "extraction")).forM fun (_, e) => say (.error e)
    say (.info s!"{why}; reporting {annotations refusals.size} as InputError")
    return .refused refusals
  match docs[0]? with
  | some (Lemma.Document.refused _ _ "no-tsconfig" ..) => whole #[] "no tsconfig.json"
  | some (Lemma.Document.refused _ _ "typecheck" _ diagnostics ..) =>
    whole (diagnostics.map (.error ·.format))
      "the program does not type check under lakatos's required options"
  | _ =>
  -- A named file the program does not include was never checked: refuse
  -- it alone, and admit the rest.
  let outside := docs.filter (reason · == some "outside-program")
  for d in outside do
    if let .refused _ _ _ message .. := d then say (.error message)
  let mut refusals : Array Refusal := #[]
  for d in outside do
    (refusedFor "extraction" d).forM fun (_, e) => say (.error e)
    refusals := refusals ++ refusedFor "gate" d ++ refusedFor "extraction" d
  -- A formula Lemma cannot read is a compile error: the run stops there.
  if let some (.refused _ _ _ message ..) := docs.find? (reason · == some "annotation") then
    return .failed message
  let checked := docs.filter (reason · != some "outside-program")
  let typing := checked.flatMap (refusedFor "typing")
  typing.forM fun (_, e) => say (.error e)
  return .admitted checked (refusals ++ typing)

end Thales
