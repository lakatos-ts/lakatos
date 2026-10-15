import Thales.Admit

/-! The plan: what a run will try, and what is settled before it does.

Each admitted file's lemma document is written into the run directory's
`thales/` mirror, and the annotations it lists sort into the ones the
engine tries (its emission carries a `#thales_prove` for each), the ones
the emitter classified itself, and the ones extraction refused. -/

namespace Thales

open Lean Tarski

/-- One file whose emission reaches Lean. -/
structure Job where
  sourceFile : String
  /-- The lemma document, as written into the run directory. -/
  jsonFile : System.FilePath
  /-- Where its artifact is rendered. -/
  leanFile : System.FilePath
  /-- The document, for the renderer. -/
  document : Json

/-- What a run will do. -/
structure Plan where
  /-- The annotations the engine will try; the join accounts for each. -/
  identities : Array Identity := #[]
  /-- Annotations the emitter settled, in envelope form. -/
  untried : Array AnnotationResult := #[]
  /-- Extraction-level input errors; each is echoed to stderr. -/
  inputErrors : Array Refusal := #[]
  notes : Array Note := #[]
  /-- The emitter failed on part of the run: exit 2 beside the rest. -/
  degraded : Bool := false
  jobs : Array Job := #[]

/-- `file`'s path relative to the current directory under `outRoot`, with
`suffix` appended to the whole name, so files differing only by extension
cannot collide; a file outside the current directory has no place there. -/
def mirrorPath (cwd : System.FilePath) (file : String) (outRoot : System.FilePath)
    (suffix : String) : Except String System.FilePath := do
  let abs : System.FilePath := if System.FilePath.isAbsolute file then file else cwd / file
  -- Normalize `.` and `..` the way `path.resolve` does.
  let parts := abs.toString.splitOn "/" |>.foldl (init := #[]) fun acc p =>
    if p == "" || p == "." then acc
    else if p == ".." then acc.pop
    else acc.push p
  let base := cwd.toString.splitOn "/" |>.filter (· != "") |>.toArray
  unless base.size < parts.size && parts.extract 0 base.size == base do
    throw s!"{file} is outside the current directory; run lakatos from the directory containing it"
  let rel := "/".intercalate (parts.extract base.size parts.size).toList
  return outRoot / (rel ++ suffix)

/-- Whether a document's emission states any obligation. -/
def hasObligations (doc : Json) : Bool :=
  match doc.getObjValD "emission" |>.getObjValD "obligations" with
  | .arr os => !os.isEmpty
  | _ => false

/-- Write each admitted file's document under `runDir`'s `thales/` and
plan the run. -/
def planRun (cwd : System.FilePath) (docs : Array Lemma.Document) (runDir : System.FilePath) :
    IO (Except String Plan) := do
  let outRoot := runDir / "thales"
  let mut plan : Plan := {}
  for d in docs do
    plan := { plan with inputErrors := plan.inputErrors ++ refusedFor "extraction" d }
    let emitted := d.annotations.filter fun a =>
      match a.outcome with
      | .tried | .classified .. => true
      | .refused .. => false
    if emitted.isEmpty then continue
    let jsonFile ← match mirrorPath cwd d.file outRoot ".json" with
      | .ok p => pure p
      | .error msg => return .error msg
    if let some dir := jsonFile.parent then IO.FS.createDirAll dir
    IO.FS.writeFile jsonFile d.json.compress
    for a in emitted do
      let i : Identity := ⟨d.file, a.function, a.property⟩
      match a.outcome with
      | .classified szs kind reason =>
        -- The envelope's field split: an engine failure explains itself
        -- in `error`, everything else in `reason`.
        let result : AnnotationResult :=
          if szs == "Error" then { identity := i, szs := .Error, error := some reason }
          else
            { identity := i, szs := if szs == "Inappropriate" then .Inappropriate else .NotTried,
              kind, reason := some reason }
        plan := { plan with untried := plan.untried.push result,
                            degraded := plan.degraded || szs == "Error" }
      | _ => plan := { plan with identities := plan.identities.push i }
    if hasObligations d.json then
      let leanFile ← match mirrorPath cwd d.file outRoot ".lean" with
        | .ok p => pure p
        | .error msg => return .error msg
      plan := { plan with jobs := plan.jobs.push { sourceFile := d.file, jsonFile, leanFile, document := d.json } }
  let n := plan.identities.size
  return .ok { plan with notes := #[.info
    s!"emitted {n} annotation{if n == 1 then "" else "s"} across {docs.size} file(s) into {outRoot}/"] }

end Thales
