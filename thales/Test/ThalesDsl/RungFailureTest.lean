import ThalesDsl.Prove
import ThalesDsl.Binders

open ThalesDsl Lean

-- A rung that simply cannot say anything must fall through to the next one.
-- Native evaluation reports its codegen and evaluation failures as ordinary
-- elaboration errors rather than runtime exceptions, so nothing in the ladder
-- catches them by default: uncontained, they escape every remaining rung and
-- become the annotation's Error.

-- A plain error is contained.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let r ← orFallThrough (α := Unit) (throwError "codegen exploded")
  return r.isNone

-- The kernel's own budget exhaustion is not: that is starvation, and only
-- runRung may classify it.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  try
    let _ ← orFallThrough (α := Unit)
      (throwError "(kernel) deterministic timeout at 'x'")
    return false
  catch _ => return true

-- Grind's own budget exhaustion is starvation too: contained inside the rung,
-- it would ship as a residual-goal GaveUp, which reads as a dead end rather
-- than as the budget it was.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let p ← Elab.Term.elabTerm (← `(∀ n : Nat, n < 5 ∨ 5 ≤ n)) (some (mkSort .zero))
  let root ← Meta.mkFreshExprMVar p
  let (outcome, starved) ←
    runRung (withHeartbeats 1 (attemptGrind ⟨"c.ts", "f", "p"⟩ p root root.mvarId! p))
  return outcome.isNone && starved

-- The real call site. A classical instance is decidable enough for `mkDecide`
-- to build the goal but noncomputable, so codegen fails inside `nativeEqTrue`
-- — the oracle has no answer instead of taking the ladder down with it.
/-- info: true -/
#guard_msgs in
open Classical in
#eval show Elab.Term.TermElabM Bool from do
  let p ← Elab.Term.elabTerm (← `(∀ n : Nat, n < 5 ∨ 5 ≤ n)) (some (mkSort .zero))
  let r ← attemptOracle ⟨"c.ts", "f", "p"⟩ p (← `((none : Option (List WitnessValue)))) []
  return r.isNone

-- The ladder hands the rungs a fully elaborated proposition; a pending
-- instance left in it would reach the kernel as a metavariable.
def elabProp (stx : TSyntax `term) : Elab.Term.TermElabM Expr := do
  let p ← Elab.Term.elabTerm stx (some (mkSort .zero))
  Elab.Term.synthesizeSyntheticMVarsNoPostponing
  instantiateMVars p

-- A true claim: the oracle holds a proof of the proposition and adds no
-- theorem to the environment.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let p ← elabProp (← `(∀ n : Nat, n < 5 → n < 6))
  let before := (← getEnv).contains (freshTheoremName (← getEnv) ⟨"c.ts", "f", "p"⟩)
  let some (.proved proof) ← attemptOracle ⟨"c.ts", "f", "p"⟩ p
      (← `((none : Option (List WitnessValue)))) [] | return false
  let after := (← getEnv).contains (freshTheoremName (← getEnv) ⟨"c.ts", "f", "p"⟩)
  return !before && !after && (← Meta.isDefEq (← Meta.inferType proof) p)

-- A false claim with a binder: the refutation is final and carries the
-- compiled witness.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let p ← elabProp (← `(∀ n : Nat, n < 5 → n < 4))
  let search ← `(ThalesDsl.findCexIco 0 5 (fun (x : Int) =>
    if x < 4 then (none : Option (List ThalesDsl.WitnessValue)) else some []))
  let some (.refuted v) ← attemptOracle ⟨"c.ts", "f", "p"⟩ p search ["n"] | return false
  return v.szs == .CounterSatisfiable && v.counterexample == some #[("n", .int 4)]

-- The held proof, admitted: a Theorem resting on the native axiom.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let p ← elabProp (← `(∀ n : Nat, n < 5 → n < 6))
  let some (.proved proof) ← attemptOracle ⟨"c.ts", "g", "q"⟩ p
      (← `((none : Option (List WitnessValue)))) [] | return false
  let some v ← admitHeldProof ⟨"c.ts", "g", "q"⟩ p proof | return false
  return v.szs == .Theorem && v.axioms == some #[``Lean.ofReduceBool]

-- The oracle's witness is searched compiled: a witness at the far end of
-- a wide range costs what the scan costs, not one whnf step per element.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let s ← Elab.Term.elabTerm (← `(ThalesDsl.findCexIco 0 20000 (fun (x : Int) =>
    if x < 19999 then (none : Option (List ThalesDsl.WitnessValue)) else some []))) none
  Elab.Term.synthesizeSyntheticMVarsNoPostponing
  let r ← evalWitnessSearch (← instantiateMVars s)
  return r == some [.int 19999]

-- A term the compiler cannot evaluate degrades to `none`: an opaque with no
-- implementation is the shape a residual site takes.
noncomputable opaque noImpl : Option (List WitnessValue)

/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let s ← Elab.Term.elabTerm (← `((noImpl : Option (List ThalesDsl.WitnessValue)))) none
  Elab.Term.synthesizeSyntheticMVarsNoPostponing
  let r ← evalWitnessSearch (← instantiateMVars s)
  return r == none

-- A false claim with a binder whose witness search cannot run: the
-- refutation is final and ships without the illustration, never as a
-- Timeout and never as an Error.
/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let p ← elabProp (← `(∀ n : Nat, n < 5 → n < 4))
  let some (.refuted v) ← attemptOracle ⟨"c.ts", "f", "p"⟩ p
      (← `((noImpl : Option (List ThalesDsl.WitnessValue)))) ["n"] | return false
  return v.szs == .GaveUp && v.counterexample.isNone
