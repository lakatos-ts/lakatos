import Thales.Json
import ThalesDsl.Verdict

/-! The envelope: thales's one report of a run, `spec/envelope.schema.json`.

One entry per annotation, each an SZS status with the fields that status
carries. The vocabulary is `ThalesDsl.Szs` — the statuses a verdict line
can carry — plus the two only the tool itself reports: `InputError`, an
annotation refused before any engine ran, and `User`, one an interrupted
run never finished. -/

namespace Thales

open Lean

/-- Every status an envelope entry can carry, in `spec/`'s order. -/
inductive Szs where
  | Theorem
  | CounterSatisfiable
  | GaveUp
  | Error
  | NotTried
  | Inappropriate
  | InputError
  | Timeout
  | User
  deriving DecidableEq, Repr, Inhabited

/-- The wire spelling: each constructor's own name. -/
def Szs.toString : Szs → String
  | .Theorem => "Theorem"
  | .CounterSatisfiable => "CounterSatisfiable"
  | .GaveUp => "GaveUp"
  | .Error => "Error"
  | .NotTried => "NotTried"
  | .Inappropriate => "Inappropriate"
  | .InputError => "InputError"
  | .Timeout => "Timeout"
  | .User => "User"

instance : ToString Szs := ⟨Szs.toString⟩

/-- A verdict line's status as an envelope status. -/
def Szs.ofProve : ThalesDsl.Szs → Szs
  | .Theorem => .Theorem
  | .CounterSatisfiable => .CounterSatisfiable
  | .Inappropriate => .Inappropriate
  | .GaveUp => .GaveUp
  | .Timeout => .Timeout
  | .NotTried => .NotTried
  | .Error => .Error

/-- A status a verdict line may carry, by its wire spelling; `InputError`,
`User`, and anything invented are not among them. -/
def proveStatus? : String → Option ThalesDsl.Szs
  | "Theorem" => some .Theorem
  | "CounterSatisfiable" => some .CounterSatisfiable
  | "Inappropriate" => some .Inappropriate
  | "GaveUp" => some .GaveUp
  | "Timeout" => some .Timeout
  | "NotTried" => some .NotTried
  | "Error" => some .Error
  | _ => none

/-- Where an annotation lives and what it claims. -/
structure Identity where
  file : String
  function : String
  property : String
  deriving DecidableEq, Repr, Inhabited

/-- `JSON.stringify([file, function, property])`: how a message names an
annotation, and the key the join matches verdicts by. -/
def Identity.key (i : Identity) : String :=
  (Out.arr #[.str i.file, .str i.function, .str i.property]).compact

/-- What the prover established about its model of the annotated
declaration: proved equal to the evaluator's run of its own syntax tree,
or not, and why not. -/
inductive ModelField where
  | validated
  | unvalidated (reason : String)
  deriving DecidableEq, Repr

def ModelField.toOut : ModelField → Out
  | .validated => .obj #[("status", "validated")]
  | .unvalidated r => .obj #[("status", "unvalidated"), ("reason", .str r)]

/-- The reason a declaration the artifact printed no model line for
carries: nothing was proved, so the model is unvalidated and says so. -/
def unstatedModelReason (fn : String) : String :=
  s!"no correspondence obligation was stated for '{fn}'"

/-- Whether a status carries the model field: a Theorem must, and the
other four the prover reaches do; an Error, a NotTried, and the two the
tool reports never do. -/
def Szs.carriesModel : Szs → Bool
  | .Theorem | .GaveUp | .Timeout | .CounterSatisfiable | .Inappropriate => true
  | _ => false

/-- The model field one annotation gets: none for a status that does not
carry it, the model line's own account where there is a line, and the
unstated reason where there is none. -/
def modelFor (szs : Szs) (line : Option ModelField) (fn : String) : Option ModelField :=
  if !szs.carriesModel then none
  else some (line.getD (.unvalidated (unstatedModelReason fn)))

/-- The one `kind` thales writes beside `falsified`: a NotTried whose
range only fits the prover's domain after the safe-integer clamp. -/
def unsupportedRangeKind : String := "unsupported-range"

/-- One annotation's outcome. Which fields are present depends on the
status, as the schema says; each is printed in the order below whenever
it is present, which is the order every shape thales writes lists them
in. -/
structure AnnotationResult where
  identity : Identity
  szs : Szs
  kind : Option String := none
  /-- Binder name to value, as the verdict line carried it. -/
  counterexample : Option (Array (String × Json)) := none
  error : Option String := none
  reason : Option String := none
  axioms : Option (Array String) := none
  model : Option ModelField := none
  deriving Inhabited

def AnnotationResult.toOut (a : AnnotationResult) : Out :=
  let opt {α : Type} (k : String) (v : Option α) (f : α → Out) : Array (String × Out) :=
    match v with
    | some x => #[(k, f x)]
    | none => #[]
  .obj <|
    #[("file", .str a.identity.file), ("function", .str a.identity.function),
      ("property", .str a.identity.property), ("szs", .str a.szs.toString)]
    ++ opt "kind" a.kind .str
    ++ opt "counterexample" a.counterexample (fun c => .obj (c.map fun (k, v) => (k, Out.ofJson v)))
    ++ opt "error" a.error .str
    ++ opt "reason" a.reason .str
    ++ opt "axioms" a.axioms (fun xs => .arr (xs.map .str))
    ++ opt "model" a.model ModelField.toOut

/-- An annotation refused as bad input. -/
def inputError (i : Identity) (error : String) : AnnotationResult :=
  { identity := i, szs := .InputError, error := some error }

/-- Every annotation an interrupted run never finished evaluating:
processing stopped at the user's request, and the reason names the
signal that asked. -/
def interruptedResults (identities : Array Identity) (signal : String) : Array AnnotationResult :=
  identities.map fun i =>
    { identity := i, szs := .User, reason := some s!"the run was interrupted ({signal})" }

/-- The whole report of one run. -/
structure Envelope where
  version : String
  startedAt : String
  cwd : String
  annotations : Array AnnotationResult
  deriving Inhabited

def Envelope.toOut (e : Envelope) : Out :=
  .obj #[("version", .str e.version), ("startedAt", .str e.startedAt), ("cwd", .str e.cwd),
    ("annotations", .arr (e.annotations.map AnnotationResult.toOut))]

/-- The envelope as the tool prints it on stdout. -/
def Envelope.render (e : Envelope) : String := e.toOut.pretty

end Thales
