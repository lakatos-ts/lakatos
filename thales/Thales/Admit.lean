import Tarski.Lemma
import Thales.Envelope

/-! From lemma's documents to what the run needs: the notes `admit`
prints, the refused run, or the admitted files with their annotations
partitioned. The strings are lemma's; this module only orders them, as
`lemma/src/admit.ts` does. -/

namespace Thales

open Tarski.Lemma (Document Annotation Outcome Diagnostic)

/-- A stderr line: `error: <text>` when `error`, else `thales: <text>`. -/
structure Note where
  error : Bool
  text : String
deriving BEq, Repr

structure FilePlan where
  file : String
  /-- The whole document, written to the run directory as lemma printed it. -/
  document : Lean.Json
  emission : Option Lean.Json
  tried : Array Identity
  classified : Array AnnotationResult
  extractionRefusals : Array AnnotationResult
deriving Inhabited

inductive Admission where
  /-- A formula Lemma cannot read: `notes` went out before it was found. -/
  | abort (notes : Array Note) (message : String)
  | refused (notes : Array Note) (refusals : Array AnnotationResult)
  | admitted (notes : Array Note) (files : Array FilePlan)
      (gateRefusals typingRefusals : Array AnnotationResult)

def pluralAnnotations (n : Nat) : String :=
  s!"{n} annotation{if n == 1 then "" else "s"}"

def classifiedResult (szs : String) (kind : Option String) (reason : String) : Result :=
  match Szs.ofString? szs with
  | some .Error => .error reason
  | some s => .classified s kind reason
  | none => .error s!"unknown classified status '{szs}'"

private def idOf (file : String) (a : Annotation) : Identity := ⟨file, a.function, a.property⟩

private def refusalsWithCause (d : Document) (cause : String) : Array AnnotationResult :=
  d.annotations.filterMap fun a => match a.outcome with
    | .refused c e => if c == cause then some ⟨idOf d.file a, .inputError e⟩ else none
    | _ => none

private def echo (rs : Array AnnotationResult) : Array Note :=
  rs.filterMap fun r => match r.result with
    | .inputError e => some ⟨true, e⟩
    | _ => none

private def filePlan (d : Document) : FilePlan := Id.run do
  let mut tried := #[]
  let mut classified := #[]
  for a in d.annotations do
    match a.outcome with
    | .tried => tried := tried.push (idOf d.file a)
    | .classified s k r => classified := classified.push ⟨idOf d.file a, classifiedResult s k r⟩
    | .refused .. => pure ()
  { file := d.file, document := d.json, emission := (d.json.getObjVal? "emission").toOption,
    tried, classified, extractionRefusals := refusalsWithCause d "extraction" }

private def reasonOf : Document → Option String
  | .refused _ _ r .. => some r
  | .program .. => none

def admit (discovered : Bool) (docs : Array Document) : Admission := Id.run do
  let discovery : Array Note :=
    if discovered then #[⟨false, s!"no files given; discovered {docs.size} file(s) via tsconfig.json"⟩] else #[]
  let wholeRun (reason : String) : Bool := docs.size > 0 && docs.all (reasonOf · == some reason)
  let extraction := docs.flatMap (refusalsWithCause · "extraction")
  let allRefusals := docs.flatMap (refusalsWithCause · "gate") ++ extraction
  if wholeRun "no-tsconfig" then
    return .refused (discovery ++ echo extraction ++
      #[⟨false, s!"no tsconfig.json; reporting {pluralAnnotations allRefusals.size} as InputError"⟩]) allRefusals
  if wholeRun "typecheck" then
    -- Every document carries the whole project's diagnostics.
    let diagnostics := match docs[0]! with
      | .refused _ _ _ _ ds .. => ds.map fun d => Note.mk true d.format
      | .program .. => #[]
    return .refused (discovery ++ diagnostics ++ echo extraction ++
      #[⟨false, s!"the program does not type check under lakatos's required options; reporting {pluralAnnotations allRefusals.size} as InputError"⟩]) allRefusals
  -- admit.ts notes every outside file before echoing any of their
  -- extraction refusals, and both before it reads a formula.
  let outside := docs.filter (reasonOf · == some "outside-program")
  let outsideNotes := outside.filterMap (fun
      | .refused _ _ _ m .. => some (Note.mk true m)
      | .program .. => none) ++
    echo (outside.flatMap (refusalsWithCause · "extraction"))
  if let some (.refused _ _ _ m ..) := docs.find? (reasonOf · == some "annotation") then
    return .abort (discovery ++ outsideNotes) m
  let mut files : Array FilePlan := #[]
  let mut gate : Array AnnotationResult := #[]
  let mut typing : Array AnnotationResult := #[]
  for d in docs do
    match reasonOf d with
    | none | some "syntax" =>
      -- A syntax refusal after the gate is the parser disagreeing with
      -- tsc; the emission is there and the proofs go on.
      files := files.push (filePlan d)
      typing := typing ++ refusalsWithCause d "typing"
    | some _ =>
      gate := gate ++ refusalsWithCause d "gate" ++ refusalsWithCause d "extraction"
  return .admitted (discovery ++ outsideNotes ++ echo typing) files gate typing

end Thales
