import Thales.Envelope

open Lean Thales

def clamp : Identity := ⟨"foo.ts", "clamp", "upper bound"⟩

def budget : ModelField := .unvalidated "budget: the attempt exceeded thales.validateHeartbeats = 1"

-- Every carrier gets the field, with a line and without.
#guard [Szs.Theorem, .GaveUp, .Timeout, .CounterSatisfiable, .Inappropriate].all fun szs =>
  modelFor szs (some budget) "f" == some budget
  && modelFor szs none "f" == some (.unvalidated (unstatedModelReason "f"))
  && modelFor szs (some .validated) "f" == some .validated

-- No other status carries it.
#guard [Szs.Error, .NotTried, .InputError, .User].all fun szs =>
  modelFor szs (some budget) "f" == none

#guard unstatedModelReason "a" = "no correspondence obligation was stated for 'a'"

-- Statuses: a verdict line carries seven, the envelope nine.
#guard [Szs.Theorem, .CounterSatisfiable, .GaveUp, .Error, .NotTried, .Inappropriate,
    .InputError, .Timeout, .User].map toString
  = ["Theorem", "CounterSatisfiable", "GaveUp", "Error", "NotTried", "Inappropriate",
    "InputError", "Timeout", "User"]
#guard ["Theorem", "CounterSatisfiable", "GaveUp", "Error", "NotTried", "Inappropriate",
    "Timeout"].all fun s => (proveStatus? s).map (toString ∘ Szs.ofProve) == some s
#guard ["InputError", "User", "Proven", ""].all fun s => (proveStatus? s).isNone

#guard clamp.key = "[\"foo.ts\",\"clamp\",\"upper bound\"]"

-- An interrupted run's entries name the signal.
#guard (interruptedResults #[clamp] "SIGINT").map (·.toOut.compact)
  = #["{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"User\",\"reason\":\"the run was interrupted (SIGINT)\"}"]

-- Each shape thales writes, field for field in the TypeScript tool's order.
#guard (inputError clamp "bad").toOut.compact
  = "{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"InputError\",\"error\":\"bad\"}"
#guard ({ identity := clamp, szs := .Theorem, axioms := some #["Lean.ofReduceBool"],
          model := some .validated } : AnnotationResult).toOut.compact
  = "{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"Theorem\",\"axioms\":[\"Lean.ofReduceBool\"],\"model\":{\"status\":\"validated\"}}"
#guard ({ identity := clamp, szs := .CounterSatisfiable, kind := some "falsified",
          counterexample := some #[("x", (0 : Json)), ("y", "9007199254740992")],
          model := some budget } : AnnotationResult).toOut.compact
  = "{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"CounterSatisfiable\",\"kind\":\"falsified\",\"counterexample\":{\"x\":0,\"y\":\"9007199254740992\"},\"model\":{\"status\":\"unvalidated\",\"reason\":\"budget: the attempt exceeded thales.validateHeartbeats = 1\"}}"
#guard ({ identity := clamp, szs := .NotTried, kind := some unsupportedRangeKind,
          reason := some "r" } : AnnotationResult).toOut.compact
  = "{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"NotTried\",\"kind\":\"unsupported-range\",\"reason\":\"r\"}"
#guard ({ identity := clamp, szs := .NotTried } : AnnotationResult).toOut.compact
  = "{\"file\":\"foo.ts\",\"function\":\"clamp\",\"property\":\"upper bound\",\"szs\":\"NotTried\"}"

-- The envelope prints as `JSON.stringify(envelope, null, 2)`.
#guard ({ version := "0.1.0", startedAt := "2026-10-15T07:02:47.147Z", cwd := "/p",
          annotations := #[inputError clamp "bad"] } : Envelope).render
  = "{
  \"version\": \"0.1.0\",
  \"startedAt\": \"2026-10-15T07:02:47.147Z\",
  \"cwd\": \"/p\",
  \"annotations\": [
    {
      \"file\": \"foo.ts\",
      \"function\": \"clamp\",
      \"property\": \"upper bound\",
      \"szs\": \"InputError\",
      \"error\": \"bad\"
    }
  ]
}"
#guard ({ version := "0.1.0", startedAt := "t", cwd := "/p", annotations := #[] } : Envelope).render
  = "{\n  \"version\": \"0.1.0\",\n  \"startedAt\": \"t\",\n  \"cwd\": \"/p\",\n  \"annotations\": []\n}"
