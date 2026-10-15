import Thales.Verdicts

/-! Joining verdict lines onto the annotations a run tried.

The emitter writes exactly one `#thales_prove` per annotation it does
not classify itself, so a missing, duplicate, or surplus verdict means
the run cannot be trusted, and the join says so instead of answering. -/

namespace Thales

open Lean

/-- The join's answer: one envelope entry per identity, in the
identities' order, or every reason the verdicts cannot be trusted. -/
inductive Joined where
  | joined (annotations : Array AnnotationResult)
  | mismatched (messages : Array String)
  deriving Inhabited

/-- One verdict as its envelope entry. The Theorem reason (a run-internal
kernel name) is dropped — what the proof rests on travels as its axioms —
and so is the CounterSatisfiable one: its substance is the
counterexample. An Error's diagnostic travels in `error` like every
other engine failure. -/
def verdictResult (i : Identity) (v : Verdict) (line : Option ModelField) : AnnotationResult :=
  let szs := Szs.ofProve v.szs
  let model := modelFor szs line i.function
  match v.szs with
  | .Theorem => { identity := i, szs, axioms := some (v.axioms.getD #[]), model }
  | .CounterSatisfiable =>
    { identity := i, szs, kind := some "falsified", counterexample := v.counterexample, model }
  | .Error => { identity := i, szs, error := some v.reason }
  | _ => { identity := i, szs, reason := some v.reason, model }

/-- Join the tried identities against the verdict and model lines. A
model line is per declaration, so one serves every annotation of its
function; a second for the same declaration is as unhealthy as a
duplicate verdict, while one for a function no annotation names is not —
the emitter states an obligation for every entry-module declaration. -/
def joinVerdicts (identities : Array Identity) (verdicts : Array Verdict)
    (models : Array ModelLine) : Joined := Id.run do
  let mut messages : Array String := #[]
  let mut modelBy : Std.HashMap (String × String) ModelField := {}
  for m in models do
    let key := (m.file, m.function)
    if modelBy.contains key then
      messages := messages.push
        s!"duplicate model line for {(Out.arr #[.str m.file, .str m.function]).compact}"
    modelBy := modelBy.insert key m.model
  -- Keys in first-seen order, so surplus verdicts are named in the order
  -- the artifacts printed them.
  let mut byKey : Std.HashMap String Verdict := {}
  let mut order : Array String := #[]
  for v in verdicts do
    let key := v.identity.key
    if byKey.contains key then
      messages := messages.push s!"duplicate verdict for {key}"
    else order := order.push key
    -- An empty counterexample counts as none: the envelope requires at
    -- least one binder on a falsified annotation.
    if v.szs == .CounterSatisfiable && (v.counterexample.getD #[]).isEmpty then
      messages := messages.push s!"CounterSatisfiable verdict for {key} carries no counterexample"
    byKey := byKey.insert key v
  let mut annotations : Array AnnotationResult := #[]
  for i in identities do
    let key := i.key
    match byKey.get? key with
    | none => messages := messages.push s!"no verdict for {key}"
    | some v =>
      byKey := byKey.erase key
      annotations := annotations.push (verdictResult i v (modelBy.get? (i.file, i.function)))
  for key in order do
    if byKey.contains key then
      messages := messages.push s!"verdict for unknown annotation {key}"
  if messages.isEmpty then .joined annotations else .mismatched messages

end Thales
