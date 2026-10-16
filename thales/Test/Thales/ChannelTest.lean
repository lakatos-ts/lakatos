import Thales.Channel

open Thales Lean

def good : String :=
  "noise before\n" ++
  "thales-verdict:{\"identity\":[\"a.ts\",\"f\",\"p\"],\"szs\":\"CounterSatisfiable\",\"reason\":\"false\",\"counterexample\":{\"y\":\"-12345678901234567890\",\"x\":1,\"b\":true}}\n" ++
  "thales-model:{\"file\":\"a.ts\",\"function\":\"f\",\"status\":\"validated\"}\n" ++
  "thales-verdict:{\"identity\":[\"a.ts\",\"g\",\"q\"],\"szs\":\"Theorem\",\"reason\":\"ok\",\"axioms\":[\"Lean.ofReduceBool\"]}\n" ++
  "\n   \nunsolved goal\n"

def ch := parseChannel good
#guard ch.messages.isEmpty
#guard ch.diagnostics == #["noise before", "unsolved goal"]
#guard ch.verdicts.size == 2
-- A decimal string stays a string; the object is kept whole.
#guard ch.verdicts[0]!.counterexample ==
  some (Json.mkObj [("y", "-12345678901234567890"), ("x", (1 : Nat)), ("b", true)])
#guard ch.verdicts[1]!.axioms == some #["Lean.ofReduceBool"]
#guard ch.models == #[{ file := "a.ts", function := "f", validated := true, reason := none }]
-- Diagnostics keep their indentation.
#guard (parseChannel "  indented\n").diagnostics == #["  indented"]

-- Contract violations are messages, one per line, and the line is dropped.
#guard (parseChannel "thales-verdict:{nope").messages == #["unparseable verdict line: thales-verdict:{nope"]
#guard (parseChannel "thales-model:{nope").messages == #["unparseable model line: thales-model:{nope"]
#guard (parseChannel "thales-verdict:{\"identity\":[\"a\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"\"}").messages.size == 1
#guard (parseChannel "thales-verdict:{\"identity\":[\"a\",\"f\",\"p\"],\"szs\":\"InputError\",\"reason\":\"r\"}").messages.size == 1
#guard (parseChannel "thales-verdict:{\"identity\":[\"a\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"counterexample\":{\"x\":[1]}}").messages.size == 1
#guard (parseChannel "thales-verdict:{\"identity\":[\"a\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":[\"\"]}").messages.size == 1
#guard (parseChannel "thales-model:{\"file\":\"a\",\"function\":\"f\",\"status\":\"validated\",\"reason\":\"x\"}").messages == #["malformed model line: thales-model:{\"file\":\"a\",\"function\":\"f\",\"status\":\"validated\",\"reason\":\"x\"}"]
#guard (parseChannel "thales-model:{\"file\":\"a\",\"function\":\"f\",\"status\":\"unvalidated\"}").messages.size == 1
#guard (parseChannel "thales-model:{\"file\":\"a\",\"function\":\"f\",\"status\":\"unvalidated\",\"reason\":\"\"}").messages.size == 1
