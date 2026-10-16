import Thales.Envelope

open Thales Lean

def idA : Identity := ⟨"a.ts", "f", "p"⟩
def idKeys : List (String × Json) := [("file", "a.ts"), ("function", "f"), ("property", "p")]

-- Exactly the keys of each shape.
#guard (AnnotationResult.toJson ⟨idA, .theorem #[] .validated⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "Theorem"), ("axioms", Json.arr #[]), ("model", Json.mkObj [("status", "validated")])] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .counterSatisfiable (Json.mkObj [("x", (0 : Nat)), ("b", false)]) none⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "CounterSatisfiable"), ("kind", "falsified"), ("counterexample", Json.mkObj [("x", (0 : Nat)), ("b", false)])] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .stopped .GaveUp "why" (some (.unvalidated "budget"))⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "GaveUp"), ("reason", "why"), ("model", Json.mkObj [("status", "unvalidated"), ("reason", "budget")])] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .stopped .NotTried "bare" none⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "NotTried"), ("reason", "bare")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .classified .NotTried (some "unsupported-range") "big"⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "NotTried"), ("kind", "unsupported-range"), ("reason", "big")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .classified .Inappropriate none "async"⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "Inappropriate"), ("reason", "async")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .error "boom"⟩) == Json.mkObj (idKeys ++ ([("szs", "Error"), ("error", "boom")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .inputError "bad"⟩) == Json.mkObj (idKeys ++ ([("szs", "InputError"), ("error", "bad")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .user "the run was interrupted (SIGTERM)"⟩) ==
  Json.mkObj (idKeys ++ ([("szs", "User"), ("reason", "the run was interrupted (SIGTERM)")] : List (String × Json)))
#guard (AnnotationResult.toJson ⟨idA, .notTried⟩) == Json.mkObj (idKeys ++ ([("szs", "NotTried")] : List (String × Json)))

-- The envelope.
#guard (Envelope.toJson ⟨"0.2.0", "2026-10-15T05:51:03.286Z", "/w", #[]⟩) ==
  Json.mkObj [("version", "0.2.0"), ("startedAt", "2026-10-15T05:51:03.286Z"), ("cwd", "/w"), ("annotations", Json.arr #[])]
-- What is printed parses back to the same value.
#guard (Json.parse (Envelope.render ⟨"0.2.0", "t", "/w", #[⟨idA, .notTried⟩]⟩)).toOption ==
  some (Envelope.toJson ⟨"0.2.0", "t", "/w", #[⟨idA, .notTried⟩]⟩)

-- The model rule.
#guard modelFor .Theorem none "f" == some (.unvalidated "no correspondence obligation was stated for 'f'")
#guard modelFor .NotTried (some .validated) "f" == none
#guard modelFor .Error (some .validated) "f" == none
#guard modelFor .Inappropriate (some (.unvalidated "r")) "f" == some (.unvalidated "r")
#guard (interruptedResults #[idA] "SIGINT").map (·.result) == #[.user "the run was interrupted (SIGINT)"]
#guard Szs.ofString? "Timeout" == some .Timeout
#guard Szs.ofString? "User" == none

-- Goldens against JSON.stringify output: decimal-string counterexample,
-- a reason with quotes, a newline, and non-ASCII, and an empty annotations array.
#guard (Json.parse "{\"version\":\"0.2.0\",\"startedAt\":\"t\",\"cwd\":\"/w\",\"annotations\":[]}").toOption ==
  some (Envelope.toJson ⟨"0.2.0", "t", "/w", #[]⟩)

def goldenEnv : Envelope :=
  ⟨"0.2.0", "t", "/w", #[
    ⟨idA, .counterSatisfiable (Json.mkObj [("n", "-12345678901234567890")]) none⟩,
    ⟨idA, .stopped .GaveUp "say \"hi\"\nπ" none⟩]⟩

#guard (Json.parse "{\"version\":\"0.2.0\",\"startedAt\":\"t\",\"cwd\":\"/w\",\"annotations\":[{\"file\":\"a.ts\",\"function\":\"f\",\"property\":\"p\",\"szs\":\"CounterSatisfiable\",\"kind\":\"falsified\",\"counterexample\":{\"n\":\"-12345678901234567890\"}},{\"file\":\"a.ts\",\"function\":\"f\",\"property\":\"p\",\"szs\":\"GaveUp\",\"reason\":\"say \\\"hi\\\"\\nπ\"}]}").toOption ==
  some goldenEnv.toJson
#guard (Json.parse goldenEnv.render).toOption == some goldenEnv.toJson
