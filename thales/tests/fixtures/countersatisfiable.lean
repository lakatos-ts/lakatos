import ThalesDsl

open Js ThalesDsl

set_option autoImplicit false

-- False bounded claims: decide establishes falsity synchronously, and the
-- elaborator searches the bounded domain for the first witness.
@[js_norm, grind]
def TsModel.bump (x : JsNumber) : JsM JsNumber := do
  return x + 1

-- A false equation: bump adds one, the property says it doesn't.
#thales_prove "cs.ts" "bump" "fixed" :=
  ballIco 0 10 fun x =>
    TsModel.bump (Float.ofInt x) = pure (Float.ofInt x)

@[js_norm, grind]
def TsModel.sq (x : JsNumber) : JsM JsNumber := do
  return x * x

-- A false boolean island: fails only at the x = 0 edge.
#thales_prove "cs.ts" "sq" "positive" :=
  ballIco 0 10 fun x =>
    ((do
          return Float.lt 0 (← TsModel.sq (Float.ofInt x))) :
        JsM Bool) =
      pure true

-- Wrong on purpose: the body never mentions b, so commutativity fails at
-- the first point with a ≠ b — a two-binder witness.
@[js_norm, grind]
def TsModel.comm (a _b : JsNumber) : JsM JsNumber := do
  return a + a

#thales_prove "cs.ts" "comm" "commutes" :=
  ballIco 0 10 fun a =>
    ballIco 0 10 fun b =>
      TsModel.comm (Float.ofInt a) (Float.ofInt b) =
        TsModel.comm (Float.ofInt b) (Float.ofInt a)

-- Zero binders: falsity without a witness to extract stays a GaveUp — the
-- envelope's falsified shape requires a non-empty counterexample. Only
-- hand-written artifacts can reach this; Lemma requires a binder.
#thales_prove "cs.ts" "bump" "atZero" :=
  TsModel.bump 0 = pure 0

-- A budget the kernel cannot afford: decide starves, the symbolic rungs
-- have nothing, and evaluation refutes compiled. The witness is searched
-- compiled as well, so the last element is named at a budget where the
-- elaborator's own reduction ran out long before reaching it.
set_option thales.heartbeats 3400 in
#thales_prove "cs.ts" "bump" "belowHundred" :=
  ballIco 0 100 fun x =>
    ((do
          return Float.lt (← TsModel.bump (Float.ofInt x)) 100) :
        JsM Bool) =
      pure true

-- A witness the budget cannot afford is still the same GaveUp, never a
-- Timeout. The kernel path is the one whose search runs in the elaborator:
-- the domain is put past the evaluation cap so the compiled tier stands
-- down, and the budget fits the kernel's refutation and the reduction that
-- reads it back but not the search that would name x = 9. Heartbeats count
-- allocations, not seconds, so the window is machine-independent, but a
-- toolchain bump can shift it.
set_option thales.maxEvaluatedElements 5 in
set_option thales.heartbeats 24000 in
#thales_prove "cs.ts" "bump" "belowTen" :=
  ballIco 0 10 fun x =>
    ((do
          return Float.lt (← TsModel.bump (Float.ofInt x)) 10) :
        JsM Bool) =
      pure true
