import ThalesDsl

open Js ThalesDsl

set_option autoImplicit false

-- Compiled evaluation is the oracle for a bounded claim under the cap: it
-- runs first, and its answer is the verdict's floor. What the rungs after
-- it earn is a better proof, never a different answer.

-- `Math.fround` of an integer below 2^24 is that integer: a computation
-- the library has no lemma for, so no rung can do better than evaluation.
@[js_norm, grind]
def TsModel.narrow (x : JsNumber) : JsM JsNumber := do
  return Number.FloatOps.tsFround x

-- At a budget no rung can finish in: the oracle has already settled the
-- claim, so the held proof ships as a Theorem rather than the Timeout the
-- starved rungs would have reported.
set_option thales.heartbeats 4000 in
#thales_prove "narrow.ts" "narrow" "exact" :=
  ballIco 0 20000 fun x =>
    TsModel.narrow (Float.ofInt x) = pure (Float.ofInt x)

-- Past the evaluation cap there is no oracle, and the same budget is the
-- Timeout it always was.
set_option thales.maxEvaluatedElements 100 in
set_option thales.heartbeats 4000 in
#thales_prove "narrow.ts" "narrow" "exactCapped" :=
  ballIco 0 20000 fun x =>
    TsModel.narrow (Float.ofInt x) = pure (Float.ofInt x)

-- A true oracle does not take kernel decide's turn: a domain the kernel
-- can enumerate is still kernel-checked.
@[js_norm, grind]
def TsModel.add (x y : JsNumber) : JsM JsNumber := do
  return x + y

#thales_prove "narrow.ts" "add" "zeroNeutral" :=
  ballIco 0 10 fun x =>
    TsModel.add (Float.ofInt x) 0 = pure (Float.ofInt x)

-- Nor the symbolic rungs' turn: a domain the kernel cannot enumerate but
-- the library has a fact for is proved kernel-checked, not admitted.
@[js_norm, grind]
def TsModel.dbl (x : JsNumber) : JsM JsNumber := do
  return x * 2

#thales_prove "narrow.ts" "dbl" "doublesWide" :=
  ballIco 0 1000000 fun x =>
    TsModel.dbl (Float.ofInt x) = pure (Float.ofInt x + Float.ofInt x)

-- A false claim at the last element, at the same starved budget: the
-- refutation is final, and no rung after the oracle runs.
set_option thales.heartbeats 4000 in
#thales_prove "narrow.ts" "dbl" "below" :=
  ballIco 0 20000 fun x =>
    ((do
          return Float.lt (← TsModel.dbl (Float.ofInt x)) 39998) :
        JsM Bool) =
      pure true
