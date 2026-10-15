import Thales.Join

open Thales
open ThalesDsl (Szs)

def i (fn p : String) : Identity := ⟨"a.ts", fn, p⟩
def v (fn p : String) (szs : Szs) (cex : Option Lean.Json := none)
    (axioms : Option (Array String) := none) : Verdict :=
  { identity := i fn p, szs, reason := "r", counterexample := cex, axioms }

def one : Lean.Json := Lean.Json.mkObj [("x", (1 : Nat))]

-- The happy join: one result per identity, in identity order, models joined by function.
#guard match joinProveVerdicts #[i "f" "p", i "g" "q", i "f" "p2"]
    #[v "g" "q" .GaveUp, v "f" "p" .Theorem (axioms := some #["A"]), v "f" "p2" .CounterSatisfiable (some one)]
    #[{ file := "a.ts", function := "f", validated := true }] with
  | .joined rs => rs.map (·.result) ==
      #[.theorem #["A"] .validated,
        .stopped .GaveUp "r" (some (.unvalidated "no correspondence obligation was stated for 'g'")),
        .counterSatisfiable one (some .validated)]
  | .mismatched _ => false
-- A Theorem with no axioms field reports an empty list; an Error travels in `error`.
#guard match joinProveVerdicts #[i "f" "p", i "g" "q"] #[v "f" "p" .Theorem, v "g" "q" .Error] #[] with
  | .joined rs => rs[0]!.result == .theorem #[] (.unvalidated "no correspondence obligation was stated for 'f'")
      && rs[1]!.result == .error "r"
  | _ => false
-- NotTried from a verdict carries no model.
#guard match joinProveVerdicts #[i "f" "p"] #[v "f" "p" .NotTried]
    #[{ file := "a.ts", function := "f", validated := true }] with
  | .joined rs => rs[0]!.result == .stopped .NotTried "r" none
  | _ => false
-- An unvalidated line's reason is carried.
#guard match joinProveVerdicts #[i "f" "p"] #[v "f" "p" .Theorem]
    #[{ file := "a.ts", function := "f", validated := false, reason := some "why" }] with
  | .joined rs => rs[0]!.result == .theorem #[] (.unvalidated "why")
  | _ => false

private def mismatches (r : JoinResult) : Option (Array String) :=
  match r with | .mismatched ms => some ms | .joined _ => none

#guard mismatches (joinProveVerdicts #[i "f" "p"] #[] #[]) == some #["no verdict for [\"a.ts\",\"f\",\"p\"]"]
#guard mismatches (joinProveVerdicts #[] #[v "f" "p" .Theorem] #[]) ==
  some #["verdict for unknown annotation [\"a.ts\",\"f\",\"p\"]"]
#guard mismatches (joinProveVerdicts #[i "f" "p"] #[v "f" "p" .Theorem, v "f" "p" .Theorem] #[]) ==
  some #["duplicate verdict for [\"a.ts\",\"f\",\"p\"]"]
#guard mismatches (joinProveVerdicts #[i "f" "p"] #[v "f" "p" .CounterSatisfiable (some (Lean.Json.mkObj []))] #[]) ==
  some #["CounterSatisfiable verdict for [\"a.ts\",\"f\",\"p\"] carries no counterexample"]
#guard mismatches (joinProveVerdicts #[i "f" "p"] #[v "f" "p" .CounterSatisfiable] #[]) ==
  some #["CounterSatisfiable verdict for [\"a.ts\",\"f\",\"p\"] carries no counterexample"]
#guard mismatches (joinProveVerdicts #[i "f" "p"] #[v "f" "p" .Theorem]
    #[{ file := "a.ts", function := "f", validated := true }, { file := "a.ts", function := "f", validated := true }]) ==
  some #["duplicate model line for [\"a.ts\",\"f\"]"]
-- Model-line messages come first, then verdict messages, then missing, then surplus.
#guard mismatches (joinProveVerdicts #[i "f" "p"] #[v "g" "q" .Theorem, v "h" "r" .Theorem]
    #[{ file := "a.ts", function := "f", validated := true }, { file := "a.ts", function := "f", validated := true }]) ==
  some #["duplicate model line for [\"a.ts\",\"f\"]", "no verdict for [\"a.ts\",\"f\",\"p\"]",
    "verdict for unknown annotation [\"a.ts\",\"g\",\"q\"]", "verdict for unknown annotation [\"a.ts\",\"h\",\"r\"]"]
-- A model line for an unannotated declaration is not a mismatch.
#guard match joinProveVerdicts #[i "f" "p"] #[v "f" "p" .Theorem]
    #[{ file := "a.ts", function := "zz", validated := true }] with
  | .joined _ => true
  | _ => false
