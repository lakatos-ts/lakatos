import Js

open Js Js.Number Js.Number.FloatFacts

-- The two corpus fixtures the ladder could only settle by compiled
-- evaluation, and the domain it timed out on, as their goals read once
-- normalized: `grind` closes each from the safe-integer tags alone.

example (x : Int) (h0 : 0 ≤ x) (h1 : x < 20000) :
    Float.beq (Float.ofInt x * 2) (Float.ofInt x + Float.ofInt x) = true := by
  grind

example (x : Int) (h0 : 0 ≤ x) (h1 : x < 20000) :
    Float.beq ((Float.ofInt x + Float.ofInt x) / 2) (Float.ofInt x) = true := by
  grind

example (x : Int) (h0 : 0 ≤ x) (h1 : x < 100000000) :
    Float.beq (Float.ofInt x * 2) (Float.ofInt x + Float.ofInt x) = true := by
  grind

-- The same, by the lemmas themselves.
example (x : Int) (h0 : 0 ≤ x) (h1 : x < 100000000) :
    Float.beq (Float.ofInt x * 2) (Float.ofInt x + Float.ofInt x) = true := by
  rw [float_lit, ofInt_mul x 2 h0 (by decide) (by omega) (by decide) (by omega),
    ofInt_add x x h0 h0 (by omega), beq_ofInt _ _ (by omega) (by omega) (by omega) (by omega)]
  omega

-- The bound is not optional: past the safe range a sum rounds away.
#guard Float.beq (Float.ofInt (2 ^ 53) + Float.ofInt 1) (Float.ofInt (2 ^ 53))

-- Nothing here rests on more than Lean's standard axioms.
/-- info: 'Js.Number.FloatFacts.ofInt_add' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ofInt_add

/-- info: 'Js.Number.FloatFacts.ofInt_mul' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ofInt_mul

/-- info: 'Js.Number.FloatFacts.ofInt_div' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms ofInt_div

/-- info: 'Js.Number.FloatFacts.beq_ofInt' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms beq_ofInt
