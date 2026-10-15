import Thales.Envelope
import ThalesDsl.Verdict

/-! Reading the verdict and model channels, beside their writers in
`ThalesDsl.Verdict`: only sentinel-framed lines are contract, and a line
that breaks it is a message, not a verdict. -/

namespace Thales

open Lean (Json)
open ThalesDsl (Szs)

instance : Inhabited Szs := ⟨.NotTried⟩

structure Verdict where
  identity : Identity
  szs : Szs
  reason : String
  /-- The object as it arrived: binder names to numbers, decimal strings,
  or booleans. -/
  counterexample : Option Json := none
  axioms : Option (Array String) := none
deriving Inhabited

structure ModelLine where
  file : String
  function : String
  validated : Bool
  reason : Option String := none
deriving BEq, Repr, Inhabited

structure Channel where
  verdicts : Array Verdict := #[]
  models : Array ModelLine := #[]
  diagnostics : Array String := #[]
  messages : Array String := #[]

private def scalar : Json → Bool
  | .num _ | .str _ | .bool _ => true
  | _ => false

/-- A verdict must explain itself: every status carries a non-empty
reason, a counterexample's values are numbers, strings, or booleans, and
axioms are non-empty strings. -/
def decodeVerdict (v : Json) : Option Verdict := do
  let identity ← match v.getObjVal? "identity" with
    | .ok (.arr #[.str f, .str fn, .str p]) => some (Identity.mk f fn p)
    | _ => none
  let szs ← (v.getObjValAs? String "szs").toOption >>= Szs.ofString?
  let reason ← (v.getObjValAs? String "reason").toOption
  if reason.isEmpty then none
  let counterexample ← match v.getObjVal? "counterexample" with
    | .error _ => some none
    | .ok c@(.obj m) => if m.toList.all (fun (_, x) => scalar x) then some (some c) else none
    | .ok _ => none
  let axioms ← match v.getObjVal? "axioms" with
    | .error _ => some none
    | .ok (.arr xs) => do
      let strs ← xs.mapM fun | .str s => if s.isEmpty then none else some s | _ => none
      some (some strs)
    | .ok _ => none
  pure { identity, szs, reason, counterexample, axioms }

/-- The reason is present, non-empty, and `unvalidated` together, or
absent and `validated` together. -/
def decodeModelLine (m : Json) : Option ModelLine := do
  let file ← (m.getObjValAs? String "file").toOption
  let function ← (m.getObjValAs? String "function").toOption
  match (m.getObjValAs? String "status").toOption, (m.getObjValAs? String "reason").toOption with
  | some "validated", none =>
    if (m.getObjVal? "reason").toOption.isSome then none
    else some { file, function, validated := true }
  | some "unvalidated", some r =>
    if r.isEmpty then none else some { file, function, validated := false, reason := some r }
  | _, _ => none

/-- Split one artifact's stdout. Blank lines are dropped; every other
unframed line is a diagnostic, kept as it came. -/
def parseChannel (stdout : String) : Channel := Id.run do
  let mut ch : Channel := {}
  for line in stdout.splitOn "\n" do
    if line.trimAscii.isEmpty then continue
    if line.startsWith ThalesDsl.ModelLine.sentinel then
      match Json.parse (line.drop ThalesDsl.ModelLine.sentinel.length).toString with
      | .error _ => ch := { ch with messages := ch.messages.push s!"unparseable model line: {line}" }
      | .ok j => match decodeModelLine j with
        | none => ch := { ch with messages := ch.messages.push s!"malformed model line: {line}" }
        | some m => ch := { ch with models := ch.models.push m }
    else if line.startsWith ThalesDsl.Verdict.sentinel then
      match Json.parse (line.drop ThalesDsl.Verdict.sentinel.length).toString with
      | .error _ => ch := { ch with messages := ch.messages.push s!"unparseable verdict line: {line}" }
      | .ok j => match decodeVerdict j with
        | none => ch := { ch with messages := ch.messages.push s!"malformed verdict line: {line}" }
        | some v => ch := { ch with verdicts := ch.verdicts.push v }
    else
      ch := { ch with diagnostics := ch.diagnostics.push line }
  return ch

end Thales
