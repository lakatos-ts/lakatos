import Std.Data.HashMap
import Thales.Channel

/-! Matching verdict lines to annotation identities. The emitter writes
exactly one `#thales_prove` per annotation it does not classify itself,
so a missing, duplicate, or surplus verdict means the run cannot be
trusted. -/

namespace Thales

open ThalesDsl (Szs)

inductive JoinResult where
  | joined (annotations : Array AnnotationResult)
  | mismatched (messages : Array String)

/-- The spelling the messages use for an identity: a JSON array
(`Json.compress` agrees with `JSON.stringify` here). -/
def identityKey (i : Identity) : String :=
  (Lean.Json.arr #[.str i.file, .str i.function, .str i.property]).compress

private def modelKey (file function : String) : String :=
  (Lean.Json.arr #[.str file, .str function]).compress

/-- The Theorem reason (a run-internal kernel name) is dropped, and so is
the CounterSatisfiable one: its substance is the counterexample. Error
diagnostics travel in `error`. -/
def verdictResult (v : Verdict) (line : Option ModelLine) : Result :=
  let field := line.map fun m => if m.validated then ModelField.validated else .unvalidated (m.reason.getD "")
  let model := modelFor v.szs field v.identity.function
  match v.szs with
  | .Theorem =>
    .theorem (v.axioms.getD #[]) (model.getD (.unvalidated (unstatedModelReason v.identity.function)))
  | .CounterSatisfiable => .counterSatisfiable (v.counterexample.getD (Lean.Json.mkObj [])) model
  | .Error => .error v.reason
  | s => .stopped s v.reason model

def joinProveVerdicts (identities : Array Identity) (verdicts : Array Verdict)
    (models : Array ModelLine) : JoinResult := Id.run do
  let mut messages : Array String := #[]
  -- A model line is per declaration; a second one for the same declaration
  -- is a channel violation, a line no annotation names is not.
  let mut modelByKey : Std.HashMap String ModelLine := {}
  for m in models do
    let key := modelKey m.file m.function
    if modelByKey.contains key then
      messages := messages.push s!"duplicate model line for {key}"
    modelByKey := modelByKey.insert key m
  let mut byKey : Std.HashMap Identity Verdict := {}
  let mut order : Array Identity := #[]
  for v in verdicts do
    if byKey.contains v.identity then
      messages := messages.push s!"duplicate verdict for {identityKey v.identity}"
    else
      order := order.push v.identity
    -- An empty counterexample counts as none: the schema wants a pair.
    if v.szs == .CounterSatisfiable &&
        (match v.counterexample with | some (.obj m) => m.isEmpty | _ => true) then
      messages := messages.push s!"CounterSatisfiable verdict for {identityKey v.identity} carries no counterexample"
    byKey := byKey.insert v.identity v
  let mut out : Array AnnotationResult := #[]
  for id in identities do
    match byKey[id]? with
    | none => messages := messages.push s!"no verdict for {identityKey id}"
    | some v =>
      byKey := byKey.erase id
      out := out.push ⟨id, verdictResult v modelByKey[modelKey id.file id.function]?⟩
  -- Surplus verdicts, in the order their keys first arrived.
  for id in order do
    if byKey.contains id then
      messages := messages.push s!"verdict for unknown annotation {identityKey id}"
  if messages.isEmpty then .joined out else .mismatched messages

end Thales
