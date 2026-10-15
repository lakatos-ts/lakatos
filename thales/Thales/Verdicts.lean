import Thales.Envelope

/-! Reading an artifact's stdout: the verdict channel and the model channel.

`lake env lean` on an artifact prints Lean's own diagnostics and, framed
by a sentinel, one `#thales_prove` verdict per tried annotation and one
`#thales_validate` model line per declaration (`ThalesDsl/Verdict.lean`
prints both). Only framed lines are contract; anything else is a
diagnostic. A framed line that does not parse, or parses to something
outside the contract, is the engine misreporting on itself, and fails
the artifact it came from. -/

namespace Thales

open Lean

/-- One verdict line. Counterexample values are integers (outside the JS
safe-integer range, decimal strings) or booleans. -/
structure Verdict where
  identity : Identity
  szs : ThalesDsl.Szs
  reason : String
  counterexample : Option (Array (String × Json)) := none
  /-- Theorem only: the non-standard axioms the proof depends on. -/
  axioms : Option (Array String) := none

/-- One model line: a declaration and what its correspondence proof
established. -/
structure ModelLine where
  file : String
  function : String
  model : ModelField
  deriving DecidableEq, Repr

/-- A field that may be absent but, when present, must decode; JSON
`null` is present, and so is a value of the wrong type. -/
private def optional {α : Type} (j : Json) (k : String) (f : Json → Option α) :
    Option (Option α) :=
  match j.getObjVal? k with
  | .error _ => some none
  | .ok v => (f v).map some

private def nonEmpty : Json → Option String
  | .str s => if s.isEmpty then none else some s
  | _ => none

private def objFields : Json → Option (Array (String × Json))
  | .obj kvs => some (kvs.foldl (fun acc k v => acc.push (k, v)) #[])
  | _ => none

/-- A verdict must explain itself: every status but Theorem and
CounterSatisfiable carries its reason into the envelope, and the two that
drop it are no cheaper for the engine to fill in. -/
def decodeVerdict (j : Json) : Option Verdict := do
  let .arr #[.str file, .str function, .str property] ← (j.getObjVal? "identity").toOption
    | none
  let .str szs ← (j.getObjVal? "szs").toOption | none
  let szs ← proveStatus? szs
  let reason ← nonEmpty (← (j.getObjVal? "reason").toOption)
  let counterexample ← optional j "counterexample" fun c => do
    let fields ← objFields c
    guard <| fields.all fun
      | (_, .num _) | (_, .str _) | (_, .bool _) => true
      | _ => false
    pure fields
  let axioms ← optional j "axioms" fun
    | .arr xs => xs.mapM nonEmpty
    | _ => none
  pure { identity := ⟨file, function, property⟩, szs, reason, counterexample, axioms }

/-- A model line must say why it is unvalidated and must not pretend a
validated one has anything to explain. -/
def decodeModelLine (j : Json) : Option ModelLine := do
  let .str file ← (j.getObjVal? "file").toOption | none
  let .str function ← (j.getObjVal? "function").toOption | none
  let reason := (j.getObjVal? "reason").toOption
  match (j.getObjVal? "status").toOption, reason with
  | some (.str "validated"), none => pure ⟨file, function, .validated⟩
  | some (.str "unvalidated"), some r => pure ⟨file, function, .unvalidated (← nonEmpty r)⟩
  | _, _ => none

/-- What JavaScript's `String.prototype.trim` strips: the ECMAScript
white space and line terminators, of which `Char.isWhitespace` knows only
four. -/
def isJsWhitespace (c : Char) : Bool :=
  c.isWhitespace || c == '\x0b' || c == '\x0c' || c == '\u00a0' || c == '\u1680'
    || (c.toNat >= 0x2000 && c.toNat <= 0x200a) || c == '\u2028' || c == '\u2029'
    || c == '\u202f' || c == '\u205f' || c == '\u3000' || c == '\ufeff'

/-- One artifact's stdout, read. `messages` are the contract violations;
any at all fail the artifact. -/
structure Channel where
  verdicts : Array Verdict := #[]
  models : Array ModelLine := #[]
  diagnostics : Array String := #[]
  messages : Array String := #[]
  deriving Inhabited

/-- Split one artifact's stdout into verdicts, model lines, unframed
diagnostic lines, and contract violations. -/
def parseChannel (stdout : String) : Channel := Id.run do
  let mut out : Channel := {}
  for line in stdout.splitOn "\n" do
    if line.all isJsWhitespace then continue
    if line.startsWith ThalesDsl.ModelLine.sentinel then
      match Json.parse (line.drop ThalesDsl.ModelLine.sentinel.length).toString with
      | .error _ => out := { out with messages := out.messages.push s!"unparseable model line: {line}" }
      | .ok j =>
        match decodeModelLine j with
        | none => out := { out with messages := out.messages.push s!"malformed model line: {line}" }
        | some m => out := { out with models := out.models.push m }
    else if line.startsWith ThalesDsl.Verdict.sentinel then
      match Json.parse (line.drop ThalesDsl.Verdict.sentinel.length).toString with
      | .error _ => out := { out with messages := out.messages.push s!"unparseable verdict line: {line}" }
      | .ok j =>
        match decodeVerdict j with
        | none => out := { out with messages := out.messages.push s!"malformed verdict line: {line}" }
        | some v => out := { out with verdicts := out.verdicts.push v }
    else
      out := { out with diagnostics := out.diagnostics.push line }
  return out

end Thales
