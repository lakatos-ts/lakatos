import Thales.Join

open Lean Thales

def id' (fn : String) : Identity := ⟨"t.ts", fn, "p"⟩

def verdict (fn : String) (szs : ThalesDsl.Szs) (reason := "r") : Verdict :=
  { identity := id' fn, szs, reason }

def validated (fn : String) : ModelLine := ⟨"t.ts", fn, .validated⟩

def unvalidated (fn reason : String) : ModelLine := ⟨"t.ts", fn, .unvalidated reason⟩

/-- A join, printed: each entry as the envelope would carry it, or the
messages. -/
def shown : Joined → Array String
  | .joined as => as.map (·.toOut.compact)
  | .mismatched ms => ms.map ("mismatched: " ++ ·)

def entry (fn rest : String) : String :=
  s!"\{\"file\":\"t.ts\",\"function\":\"{fn}\",\"property\":\"p\",{rest}}"

def unstated (fn : String) : String :=
  s!"\"model\":\{\"status\":\"unvalidated\",\"reason\":\"no correspondence obligation was stated for '{fn}'\"}"

-- Each status in its envelope shape; Error and NotTried stay bare.
#guard shown (joinVerdicts #[id' "a", id' "b", id' "c", id' "d", id' "e"]
    #[verdict "a" .Theorem "kernel-checked as X", verdict "b" .Inappropriate "await is unmapped",
      verdict "c" .Error "elaboration failed", verdict "d" .GaveUp "decide failed",
      verdict "e" .NotTried "no structured property"] #[])
  = #[entry "a" s!"\"szs\":\"Theorem\",\"axioms\":[],{unstated "a"}",
      entry "b" s!"\"szs\":\"Inappropriate\",\"reason\":\"await is unmapped\",{unstated "b"}",
      entry "c" "\"szs\":\"Error\",\"error\":\"elaboration failed\"",
      entry "d" s!"\"szs\":\"GaveUp\",\"reason\":\"decide failed\",{unstated "d"}",
      entry "e" "\"szs\":\"NotTried\",\"reason\":\"no structured property\""]

-- Order follows the identities, not the verdict lines.
#guard shown (joinVerdicts #[id' "a", id' "b"] #[verdict "b" .Theorem, verdict "a" .Theorem] #[])
  = #[entry "a" s!"\"szs\":\"Theorem\",\"axioms\":[],{unstated "a"}",
      entry "b" s!"\"szs\":\"Theorem\",\"axioms\":[],{unstated "b"}"]

-- Missing, surplus, and duplicate verdicts are mismatches naming the annotation.
#guard shown (joinVerdicts #[id' "a", id' "b"] #[verdict "a" .Theorem] #[])
  = #["mismatched: no verdict for [\"t.ts\",\"b\",\"p\"]"]
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem, verdict "ghost" .Theorem] #[])
  = #["mismatched: verdict for unknown annotation [\"t.ts\",\"ghost\",\"p\"]"]
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem, verdict "a" .GaveUp] #[])
  = #["mismatched: duplicate verdict for [\"t.ts\",\"a\",\"p\"]"]

-- A Theorem ships its axioms.
#guard shown (joinVerdicts #[id' "a"] #[{ verdict "a" .Theorem with axioms := some #["Lean.ofReduceBool"] }] #[])
  = #[entry "a" s!"\"szs\":\"Theorem\",\"axioms\":[\"Lean.ofReduceBool\"],{unstated "a"}"]

-- A CounterSatisfiable ships kind falsified and the counterexample, booleans too.
#guard shown (joinVerdicts #[id' "a"]
    #[{ verdict "a" .CounterSatisfiable with counterexample := some #[("x", (0 : Json)), ("y", "9007199254740992")] }] #[])
  = #[entry "a" s!"\"szs\":\"CounterSatisfiable\",\"kind\":\"falsified\",\"counterexample\":\{\"x\":0,\"y\":\"9007199254740992\"},{unstated "a"}"]
#guard shown (joinVerdicts #[id' "a"]
    #[{ verdict "a" .CounterSatisfiable with counterexample := some #[("b", (false : Json)), ("n", (1 : Json))] }] #[])
  = #[entry "a" s!"\"szs\":\"CounterSatisfiable\",\"kind\":\"falsified\",\"counterexample\":\{\"b\":false,\"n\":1},{unstated "a"}"]

-- Without a counterexample, or with an empty one, it is a mismatch.
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .CounterSatisfiable] #[])
  = #["mismatched: CounterSatisfiable verdict for [\"t.ts\",\"a\",\"p\"] carries no counterexample"]
#guard shown (joinVerdicts #[id' "a"] #[{ verdict "a" .CounterSatisfiable with counterexample := some #[] }] #[])
  = #["mismatched: CounterSatisfiable verdict for [\"t.ts\",\"a\",\"p\"] carries no counterexample"]

-- A Timeout joins with its reason.
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Timeout] #[])
  = #[entry "a" s!"\"szs\":\"Timeout\",\"reason\":\"r\",{unstated "a"}"]

-- Model lines: validated, unvalidated verbatim, one line for every
-- annotation of its declaration.
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem] #[validated "a"])
  = #[entry "a" "\"szs\":\"Theorem\",\"axioms\":[],\"model\":{\"status\":\"validated\"}"]
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem] #[unvalidated "a" "'**' is not supported"])
  = #[entry "a" "\"szs\":\"Theorem\",\"axioms\":[],\"model\":{\"status\":\"unvalidated\",\"reason\":\"'**' is not supported\"}"]
#guard
  match joinVerdicts #[⟨"t.ts", "a", "p"⟩, ⟨"t.ts", "a", "q"⟩, ⟨"t.ts", "a", "r"⟩, ⟨"t.ts", "a", "s"⟩]
      #[{ identity := ⟨"t.ts", "a", "p"⟩, szs := .GaveUp, reason := "r" },
        { identity := ⟨"t.ts", "a", "q"⟩, szs := .Timeout, reason := "r" },
        { identity := ⟨"t.ts", "a", "r"⟩, szs := .Inappropriate, reason := "r" },
        { identity := ⟨"t.ts", "a", "s"⟩, szs := .CounterSatisfiable, reason := "r",
          counterexample := some #[("x", (0 : Json))] }]
      #[unvalidated "a" "the run of 'a' did not reduce to its model"] with
  | .joined as => as.all (·.model == some (.unvalidated "the run of 'a' did not reduce to its model"))
  | .mismatched _ => false

-- Error and NotTried carry no model even with a line.
#guard
  match joinVerdicts #[id' "a", id' "b"] #[verdict "a" .Error, verdict "b" .NotTried]
      #[validated "a", validated "b"] with
  | .joined as => as.all (·.model.isNone)
  | .mismatched _ => false

-- A line for a function no annotation names is ignored; a second line
-- for one declaration is a mismatch naming it; a line for the same name
-- in another file does not travel.
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem] #[validated "a", validated "ghost"])
  = #[entry "a" "\"szs\":\"Theorem\",\"axioms\":[],\"model\":{\"status\":\"validated\"}"]
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem] #[validated "a", unvalidated "a" "budget"])
  = #["mismatched: duplicate model line for [\"t.ts\",\"a\"]"]
#guard shown (joinVerdicts #[id' "a"] #[verdict "a" .Theorem] #[⟨"other.ts", "a", .validated⟩])
  = #[entry "a" s!"\"szs\":\"Theorem\",\"axioms\":[],{unstated "a"}"]
