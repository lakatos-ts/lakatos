import Lean.Data.Json
import ThalesDsl.Verdict

/-! The envelope: one annotation's outcome in each shape the schema
(`spec/envelope.schema.json`) names, and the whole report. The JSON is
Lean's own: keys come out sorted and `Json.pretty` lays the lines out,
and consumers compare envelopes as values, not text. -/

namespace Thales

open Lean (Json)
open ThalesDsl (Szs)

structure Identity where
  file : String
  function : String
  property : String
deriving BEq, Hashable, Repr, Inhabited

inductive ModelField where
  | validated
  | unvalidated (reason : String)
deriving BEq, Repr, Inhabited

/-- One annotation's outcome, by envelope shape. -/
inductive Result where
  | theorem (axioms : Array String) (model : ModelField)
  /-- The counterexample is the object the channel carried, binder values
  as numbers, decimal strings, or booleans. -/
  | counterSatisfiable (counterexample : Json) (model : Option ModelField)
  /-- GaveUp, Timeout, NotTried, or Inappropriate from a verdict. -/
  | stopped (szs : Szs) (reason : String) (model : Option ModelField)
  /-- Inappropriate or NotTried settled by the emitter. -/
  | classified (szs : Szs) (kind : Option String) (reason : String)
  /-- A verdict's Error, a failed file, or an emitter Error. -/
  | error (message : String)
  | inputError (message : String)
  | user (reason : String)
  /-- An unhealthy run: nothing was learned. -/
  | notTried
deriving BEq, Inhabited

structure AnnotationResult where
  identity : Identity
  result : Result
deriving BEq, Inhabited

structure Envelope where
  version : String
  startedAt : String
  cwd : String
  annotations : Array AnnotationResult

def Szs.ofString? : String → Option Szs
  | "Theorem" => some .Theorem
  | "CounterSatisfiable" => some .CounterSatisfiable
  | "Inappropriate" => some .Inappropriate
  | "GaveUp" => some .GaveUp
  | "Timeout" => some .Timeout
  | "NotTried" => some .NotTried
  | "Error" => some .Error
  | _ => none

/-- The statuses that carry the model field. -/
def modelCarrier : Szs → Bool
  | .Theorem | .GaveUp | .Timeout | .CounterSatisfiable | .Inappropriate => true
  | .NotTried | .Error => false

def unstatedModelReason (fn : String) : String :=
  s!"no correspondence obligation was stated for '{fn}'"

/-- The model field one annotation gets: none for a status that does not
carry it, the line's own account where there is a line, and the unstated
reason where there is none. -/
def modelFor (szs : Szs) (line : Option ModelField) (fn : String) : Option ModelField :=
  if !modelCarrier szs then none
  else some (line.getD (.unvalidated (unstatedModelReason fn)))

def interruptedResults (identities : Array Identity) (signal : String) : Array AnnotationResult :=
  identities.map fun i => ⟨i, .user s!"the run was interrupted ({signal})"⟩

def Result.isRefuted : Result → Bool
  | .counterSatisfiable .. => true
  | _ => false

def ModelField.toJson : ModelField → Json
  | .validated => Json.mkObj [("status", "validated")]
  | .unvalidated r => Json.mkObj [("status", "unvalidated"), ("reason", r)]

private def modelKv : Option ModelField → List (String × Json)
  | none => []
  | some m => [("model", m.toJson)]

def AnnotationResult.toJson (a : AnnotationResult) : Json :=
  let id : List (String × Json) :=
    [("file", a.identity.file), ("function", a.identity.function), ("property", a.identity.property)]
  let szs (s : String) : List (String × Json) := [("szs", Json.str s)]
  Json.mkObj <| id ++ match a.result with
    | .theorem axioms model =>
      szs "Theorem" ++ [("axioms", Json.arr (axioms.map Json.str))] ++ modelKv (some model)
    | .counterSatisfiable cex model =>
      szs "CounterSatisfiable" ++ [("kind", Json.str "falsified"), ("counterexample", cex)] ++ modelKv model
    | .stopped s reason model => szs s.toString ++ [("reason", Json.str reason)] ++ modelKv model
    | .classified s kind reason =>
      szs s.toString ++ (kind.map fun k => [("kind", Json.str k)]).getD [] ++ [("reason", Json.str reason)]
    | .error m => szs "Error" ++ [("error", Json.str m)]
    | .inputError m => szs "InputError" ++ [("error", Json.str m)]
    | .user r => szs "User" ++ [("reason", Json.str r)]
    | .notTried => szs "NotTried"

def Envelope.toJson (e : Envelope) : Json :=
  Json.mkObj [("version", e.version), ("startedAt", e.startedAt), ("cwd", e.cwd),
              ("annotations", Json.arr (e.annotations.map AnnotationResult.toJson))]

def Envelope.render (e : Envelope) : String := e.toJson.pretty

end Thales
