import ThalesDsl

open ThalesDsl Lean Js

-- The ladder's cost on a bounded claim only evaluation can settle. Before
-- the oracle, kernel decide starved its quarter of the budget first; with
-- it, the claim is settled before any rung runs and the rungs spend only
-- their reduced windows looking for a better proof.

def TsModel.narrow (x : JsNumber) : JsM JsNumber := do
  return Number.FloatOps.tsFround x

/-- info: true -/
#guard_msgs in
#eval show Elab.Term.TermElabM Bool from do
  let budget := 200000
  let start ← IO.getNumHeartbeats
  let v ← attemptLadder ⟨"narrow.ts", "narrow", "exact"⟩
    (← `(ballIco 0 20000 fun x => TsModel.narrow (Float.ofInt x) = pure (Float.ofInt x)))
    (← `((none : Option (List WitnessValue)))) ["x"] true 20000 budget 10000000
  -- `withHeartbeats` scales the budget by a thousand; read it back in the
  -- same unit.
  let spent := ((← IO.getNumHeartbeats) - start) / 1000
  return v.szs == .Theorem && spent < budget / 4
