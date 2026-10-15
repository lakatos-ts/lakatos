import Thales.Verdicts

open Lean Thales

def verdictLine (fn szs : String) : String :=
  s!"thales-verdict:\{\"identity\":[\"t.ts\",\"{fn}\",\"p\"],\"szs\":\"{szs}\",\"reason\":\"r\"}"

def modelLine (body : String) : String := s!"thales-model:{body}"

/-- A verdict, as much of it as these tests compare. -/
def Thales.Verdict.summary (v : Verdict) : String :=
  s!"{v.identity.key} {Szs.ofProve v.szs} {v.reason} \
    {(v.counterexample.map fun c => (Out.obj (c.map fun (k, x) => (k, Out.ofJson x))).compact).getD "-"} \
    {v.axioms.getD #[]}"

-- Verdicts in order, across lines.
#guard (parseChannel (s!"{verdictLine "g" "GaveUp"}\n{verdictLine "h" "Inappropriate"}\n")).verdicts.map (·.summary)
  = #["[\"t.ts\",\"g\",\"p\"] GaveUp r - #[]", "[\"t.ts\",\"h\",\"p\"] Inappropriate r - #[]"]

-- A counterexample rides through: numbers, decimal strings, booleans.
#guard (parseChannel "thales-verdict:{\"identity\":[\"t.ts\",\"f\",\"p\"],\"szs\":\"CounterSatisfiable\",\"reason\":\"r\",\"counterexample\":{\"x\":0,\"y\":\"9007199254740992\",\"b\":false}}").verdicts.map (·.summary)
  = #["[\"t.ts\",\"f\",\"p\"] CounterSatisfiable r {\"b\":false,\"x\":0,\"y\":\"9007199254740992\"} #[]"]

-- A Theorem keeps its axioms.
#guard (parseChannel "thales-verdict:{\"identity\":[\"t.ts\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":[\"Lean.ofReduceBool\"]}").verdicts.map (·.summary)
  = #["[\"t.ts\",\"f\",\"p\"] Theorem r - #[Lean.ofReduceBool]"]

-- Each malformed framed line is one message, and nothing else.
def malformed : List String := [
  "thales-verdict:not json",
  "thales-verdict:42",
  "thales-verdict:null",
  "thales-verdict:{\"identity\":[\"a\"],\"szs\":1}",
  "thales-verdict:{\"identity\":[1,2,3],\"szs\":\"Theorem\",\"reason\":\"r\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Theorem\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"CounterSatisfiable\",\"reason\":\"r\",\"counterexample\":[]}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"CounterSatisfiable\",\"reason\":\"r\",\"counterexample\":{\"x\":null}}",
  -- A status off the prove contract: invented, or the tool's own.
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Proven\",\"reason\":\"r\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"InputError\",\"reason\":\"r\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"GaveUp\",\"reason\":\"\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":\"Lean.ofReduceBool\"}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":[1]}",
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":[\"\"]}",
  -- JSON null is a present field, not an absent one.
  "thales-verdict:{\"identity\":[\"f.ts\",\"f\",\"p\"],\"szs\":\"Theorem\",\"reason\":\"r\",\"axioms\":null}"]

#guard
  let c := parseChannel ("\n".intercalate malformed)
  c.verdicts.isEmpty && c.diagnostics.isEmpty && c.messages.size == malformed.length
#guard (parseChannel "thales-verdict:not json").messages = #["unparseable verdict line: thales-verdict:not json"]
#guard (parseChannel "thales-verdict:42").messages = #["malformed verdict line: thales-verdict:42"]

-- No stdout at all is no verdicts and nothing wrong; blank lines are
-- nothing; unframed lines are diagnostics.
#guard
  let c := parseChannel ""
  c.verdicts.isEmpty && c.models.isEmpty && c.diagnostics.isEmpty && c.messages.isEmpty
#guard (parseChannel "  \n\n\t\n").diagnostics.isEmpty
#guard (parseChannel s!"warning: unused\n{verdictLine "f" "Theorem"}\ninfo: x").diagnostics
  = #["warning: unused", "info: x"]

-- Model lines ride the same stream, in order.
#guard (parseChannel (s!"{modelLine "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"validated\"}"}\n" ++
    s!"{verdictLine "f" "Theorem"}\n" ++
    modelLine "{\"file\":\"t.ts\",\"function\":\"g\",\"status\":\"unvalidated\",\"reason\":\"the run of 'g' did not reduce to its model\"}")).models
  = #[⟨"t.ts", "f", .validated⟩, ⟨"t.ts", "g", .unvalidated "the run of 'g' did not reduce to its model"⟩]

-- Each broken model line is one message naming it.
#guard [
    "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"validated\",\"reason\":\"r\"}",
    "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"unvalidated\"}",
    "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"unvalidated\",\"reason\":\"\"}",
    "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"maybe\"}",
    "{\"file\":\"t.ts\",\"status\":\"validated\"}",
    "{\"file\":\"t.ts\",\"function\":\"f\",\"status\":\"validated\",\"reason\":null}",
    "3",
    "null"].all fun body =>
  let c := parseChannel (modelLine body)
  c.models.isEmpty && c.messages == #[s!"malformed model line: {modelLine body}"]
#guard (parseChannel "thales-model:{oops").messages = #["unparseable model line: thales-model:{oops"]
