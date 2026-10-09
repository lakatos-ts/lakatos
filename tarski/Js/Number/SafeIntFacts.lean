import Js.Number.FloatFacts
import Js.Number.FloatOpsFacts

/-!
Exact binary64 arithmetic on safe integers, from the model through
`FloatFacts`'s closed form of rounding. A natural below `2 ^ 53` has one
canonical unpacked form, `safe`; `+`, `*`, and an exact `/` carry one
safe value to another without rounding, and `Float.beq` on two of them
is equality of the integers. The `Int` layer at the end is what a
residual goal spells, with the range side conditions `grind` discharges.
-/

namespace Js.Number.FloatFacts

open Float.Model Float.Model.UnpackedFloat

/-- Round-to-nearest-even discards nothing when nothing is there. -/
theorem rnShift_of_dvd {m n : Nat} (h : m % 2 ^ n = 0) : rnShift m n = m / 2 ^ n := by
  rw [rnShift]
  simp [h, Nat.two_pow_pos]

theorem accuracyOfFraction_zero_one : accuracyOfFraction 0 1 = .exact := by
  simp [accuracyOfFraction]

/-- Scaling the mantissa up and the exponent down by the same amount does
not move the grid. -/
theorem grid_scale {m : Nat} (hm : 0 < m) (e : Int) (k : Nat) :
    grid (m * 2 ^ k) (e - k) = grid m e := by
  simp only [grid, totalExponent]
  rw [log2_mul_pow hm]
  omega

/-- A well-placed input the grid divides rounds to itself. -/
theorem roundWA_exact (s : Sign) (m : Nat) (e : Int) (hw : WellPlaced m e)
    (hd : m % 2 ^ (grid m e - e).toNat = 0)
    (hpos : 0 < m / 2 ^ (grid m e - e).toNat)
    (hcap : m / 2 ^ (grid m e - e).toNat < 2 ^ 53) :
    roundWithAccuracy .binary64 s m e (accuracyOfFraction 0 1)
      = .finite s (m / 2 ^ (grid m e - e).toNat) (grid m e) hpos := by
  rw [roundWA_eq s m e 0 1 hw Nat.one_pos Nat.zero_lt_one,
    rnShiftF_zero_num _ _ _ Nat.one_pos, rnShift_of_dvd hd]
  have h1 : ¬ (m / 2 ^ (grid m e - e).toNat = 2 ^ 53) := by omega
  have h2 : ¬ (m / 2 ^ (grid m e - e).toNat = 0) := by omega
  simp only [h1, h2, ↓reduceIte, ↓reduceDIte]

/-- `round` on an input the grid divides: the value is carried to the
grid untouched. -/
theorem round_exact (s : Sign) {m : Nat} (hm : 0 < m) (e : Int)
    (hd : m % 2 ^ (grid m e - e).toNat = 0)
    (hcap : m * 2 ^ (e - grid m e).toNat / 2 ^ (grid m e - e).toNat < 2 ^ 53) :
    ∃ hpos, round .binary64 s m e
      = .finite s (m * 2 ^ (e - grid m e).toNat / 2 ^ (grid m e - e).toNat) (grid m e) hpos := by
  have hg := grid_scale hm e (e - grid m e).toNat
  have hk : (grid m e - (e - ((e - grid m e).toNat : Int))).toNat = (grid m e - e).toNat := by
    omega
  have hd' : m * 2 ^ (e - grid m e).toNat % 2 ^ (grid m e - e).toNat = 0 := by
    rcases Nat.eq_zero_or_pos (grid m e - e).toNat with h0 | h0
    · simp [h0, Nat.mod_one]
    · have hj : (e - grid m e).toNat = 0 := by omega
      simpa [hj] using hd
  have hpos : 0 < m * 2 ^ (e - grid m e).toNat / 2 ^ (grid m e - e).toNat := by
    apply Nat.div_pos
    · exact Nat.le_of_dvd (Nat.mul_pos hm (Nat.two_pow_pos _)) (Nat.dvd_of_mod_eq_zero hd')
    · exact Nat.two_pow_pos _
  refine ⟨hpos, ?_⟩
  rw [round_eq_roundWA]
  have := roundWA_exact s (m * 2 ^ (e - grid m e).toNat) (e - ((e - grid m e).toNat : Int))
    (wellPlaced_round_input hm e) (by rw [hg, hk]; exact hd') (by rw [hg, hk]; exact hpos)
    (by rw [hg, hk]; exact hcap)
  rw [this]
  simp only [hg, hk]

theorem log2_le_52 {n : Nat} (h : n < 2 ^ 53) : n.log2 ≤ 52 := by
  rcases Nat.eq_zero_or_pos n with h0 | h0
  · simp [h0]
  rcases Nat.lt_or_ge 52 n.log2 with hc | hc
  · have h1 := Nat.log2_self_le (Nat.pos_iff_ne_zero.mp h0)
    have h2 : 2 ^ 53 ≤ 2 ^ n.log2 := Nat.pow_le_pow_right (by omega) (by omega)
    omega
  · exact hc

/-- A safe integer's mantissa, carried to the grid, has 53 bits. -/
theorem safe_mantissa_lt (n : Nat) (h : n < 2 ^ 53) : n * 2 ^ (52 - n.log2) < 2 ^ 53 := by
  have hl : n.log2 ≤ 52 := log2_le_52 h
  have h1 : n < 2 ^ (n.log2 + 1) := Nat.lt_log2_self
  calc n * 2 ^ (52 - n.log2) < 2 ^ (n.log2 + 1) * 2 ^ (52 - n.log2) :=
        Nat.mul_lt_mul_of_pos_right h1 (Nat.two_pow_pos _)
    _ = 2 ^ 53 := by rw [← Nat.pow_add]; congr 1; omega

/-- The canonical unpacked form of a safe positive integer. -/
theorem normalize_safe (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) :
    ∃ hpos, normalize .binary64 (n : Int) 0 .positive
      = .finite .positive (n * 2 ^ (52 - n.log2)) ((n.log2 : Int) - 52) hpos := by
  rw [normalize_eq_of_pos 0 .positive (by omega), Int.toNat_natCast]
  have hl : n.log2 ≤ 52 := log2_le_52 h
  have hg : grid n 0 = (n.log2 : Int) - 52 := by
    simp only [grid, totalExponent]; omega
  have hk : (grid n 0 - 0).toNat = 0 := by omega
  have hj : (0 - grid n 0).toNat = 52 - n.log2 := by omega
  obtain ⟨hp, he⟩ := round_exact .positive h0 0 (by rw [hk]; simp [Nat.mod_one])
    (by rw [hk, hj]; simpa using safe_mantissa_lt n h)
  rw [he]
  have hk' : ((n.log2 : Int) - 52 - 0).toNat = 0 := by omega
  have hj' : (0 - ((n.log2 : Int) - 52)).toNat = 52 - n.log2 := by omega
  simp only [hg, hk', hj', Nat.pow_zero, Nat.div_one]
  exact ⟨Nat.mul_pos h0 (Nat.two_pow_pos _), trivial⟩

/-! ## Safe integers as canonical unpacked floats -/

/-- The canonical unpacked form of a safe positive integer: the integer
shifted up to 53 bits, on the matching exponent. -/
def safe (n : Nat) (h0 : 0 < n) : UnpackedFloat :=
  .finite .positive (n * 2 ^ (52 - n.log2)) ((n.log2 : Int) - 52)
    (Nat.mul_pos h0 (Nat.two_pow_pos _))

theorem normalize_safe' (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) :
    normalize .binary64 (n : Int) 0 .positive = safe n h0 := by
  obtain ⟨_, he⟩ := normalize_safe n h0 h
  exact he

theorem safe_lo {n : Nat} (h0 : 0 < n) (h : n < 2 ^ 53) : 2 ^ 52 ≤ n * 2 ^ (52 - n.log2) := by
  have hl := log2_le_52 h
  have h1 := Nat.log2_self_le (Nat.pos_iff_ne_zero.mp h0)
  calc 2 ^ 52 = 2 ^ n.log2 * 2 ^ (52 - n.log2) := by rw [← Nat.pow_add]; congr 1; omega
    _ ≤ n * 2 ^ (52 - n.log2) := Nat.mul_le_mul_right _ h1

theorem mul_pow_split (n x y : Nat) (h : y ≤ x) : n * 2 ^ x = n * 2 ^ (x - y) * 2 ^ y := by
  rw [Nat.mul_assoc, ← Nat.pow_add, Nat.sub_add_cancel h]

theorem mul_pow_div_pow (n x y : Nat) (h : y ≤ x) : n * 2 ^ x / 2 ^ y = n * 2 ^ (x - y) := by
  rw [mul_pow_split n x y h, Nat.mul_div_cancel _ (Nat.two_pow_pos y)]

theorem mul_pow_mod_pow (n x y : Nat) (h : y ≤ x) : n * 2 ^ x % 2 ^ y = 0 := by
  rw [mul_pow_split n x y h, Nat.mul_mod_left]

theorem sign_pos_mul_pos : Sign.positive * Sign.positive = Sign.positive := rfl

/-- Two finite floats with equal components are equal, whatever the
positivity proofs are. -/
theorem finite_congr {s : Sign} {m₁ m₂ : Nat} {e₁ e₂ : Int} {h₁ : 0 < m₁} {h₂ : 0 < m₂}
    (hm : m₁ = m₂) (he : e₁ = e₂) :
    UnpackedFloat.finite s m₁ e₁ h₁ = .finite s m₂ e₂ h₂ := by
  subst hm; subst he; rfl

/-- The product of two safe integers whose product is safe is exact. -/
theorem mul_safe (a b : Nat) (ha : 0 < a) (hb : 0 < b) (hab : a * b < 2 ^ 53) :
    UnpackedFloat.mul .binary64 (safe a ha) (safe b hb) = safe (a * b) (Nat.mul_pos ha hb) := by
  have ha' : a < 2 ^ 53 := by have := Nat.le_mul_of_pos_right a hb; omega
  have hb' : b < 2 ^ 53 := by have := Nat.le_mul_of_pos_left b ha; omega
  have hla := log2_le_52 ha'
  have hlb := log2_le_52 hb'
  have hlab := log2_le_52 hab
  have hsum : a.log2 + b.log2 ≤ (a * b).log2 := by
    apply (Nat.le_log2 (Nat.pos_iff_ne_zero.mp (Nat.mul_pos ha hb))).mpr
    rw [Nat.pow_add]
    exact Nat.mul_le_mul (Nat.log2_self_le (Nat.pos_iff_ne_zero.mp ha))
      (Nat.log2_self_le (Nat.pos_iff_ne_zero.mp hb))
  simp only [safe, UnpackedFloat.mul, sign_pos_mul_pos]
  rw [← accuracyOfFraction_zero_one]
  have hm : a * 2 ^ (52 - a.log2) * (b * 2 ^ (52 - b.log2))
      = a * b * 2 ^ ((52 - a.log2) + (52 - b.log2)) := by
    rw [Nat.mul_mul_mul_comm, ← Nat.pow_add]
  rw [hm]
  have hlog := log2_mul_pow (Nat.mul_pos ha hb) ((52 - a.log2) + (52 - b.log2))
  have hg : grid (a * b * 2 ^ ((52 - a.log2) + (52 - b.log2)))
      (((a.log2 : Int) - 52) + ((b.log2 : Int) - 52)) = ((a * b).log2 : Int) - 52 := by
    simp only [grid, totalExponent, hlog]; omega
  have hk : (grid (a * b * 2 ^ ((52 - a.log2) + (52 - b.log2)))
      (((a.log2 : Int) - 52) + ((b.log2 : Int) - 52))
        - (((a.log2 : Int) - 52) + ((b.log2 : Int) - 52))).toNat
      = (a * b).log2 + ((52 - a.log2) + (52 - b.log2)) - 52 := by
    rw [hg]; omega
  have hle : (a * b).log2 + ((52 - a.log2) + (52 - b.log2)) - 52
      ≤ (52 - a.log2) + (52 - b.log2) := by omega
  have hw : WellPlaced (a * b * 2 ^ ((52 - a.log2) + (52 - b.log2)))
      (((a.log2 : Int) - 52) + ((b.log2 : Int) - 52)) := by
    unfold WellPlaced; rw [hg]; omega
  rw [roundWA_exact _ _ _ hw (by rw [hk]; exact mul_pow_mod_pow _ _ _ hle)
    (by rw [hk, mul_pow_div_pow _ _ _ hle]; exact Nat.mul_pos (Nat.mul_pos ha hb) (Nat.two_pow_pos _))
    (by rw [hk, mul_pow_div_pow _ _ _ hle]
        have := safe_mantissa_lt (a * b) hab
        have hx : (52 - a.log2) + (52 - b.log2) - ((a * b).log2 + ((52 - a.log2) + (52 - b.log2)) - 52)
            = 52 - (a * b).log2 := by omega
        rw [hx]; exact this)]
  have hx : (52 - a.log2) + (52 - b.log2) - ((a * b).log2 + ((52 - a.log2) + (52 - b.log2)) - 52)
      = 52 - (a * b).log2 := by omega
  exact finite_congr (by rw [hk, mul_pow_div_pow _ _ _ hle, hx]) hg

/-- The sum of two safe integers whose sum is safe is exact. -/
theorem add_safe (a b : Nat) (ha : 0 < a) (hb : 0 < b) (hab : a + b < 2 ^ 53) :
    UnpackedFloat.add .binary64 (safe a ha) (safe b hb) = safe (a + b) (by omega) := by
  have hla := log2_le_52 (show a < 2 ^ 53 by omega)
  have hlb := log2_le_52 (show b < 2 ^ 53 by omega)
  have hlab := log2_le_52 hab
  have hmono_a : a.log2 ≤ (a + b).log2 :=
    (Nat.le_log2 (by omega)).mpr
      (Nat.le_trans (Nat.log2_self_le (by omega)) (Nat.le_add_right a b))
  have hmono_b : b.log2 ≤ (a + b).log2 :=
    (Nat.le_log2 (by omega)).mpr
      (Nat.le_trans (Nat.log2_self_le (by omega)) (Nat.le_add_left b a))
  simp only [safe, UnpackedFloat.add, decreaseExponent, Nat.shiftLeft_eq, Sign.apply]
  have h1 : ((a.log2 : Int) - 52 - min ((a.log2 : Int) - 52) ((b.log2 : Int) - 52)).toNat
      = a.log2 - min a.log2 b.log2 := by omega
  have h2 : ((b.log2 : Int) - 52 - min ((a.log2 : Int) - 52) ((b.log2 : Int) - 52)).toNat
      = b.log2 - min a.log2 b.log2 := by omega
  have h3 : min ((a.log2 : Int) - 52) ((b.log2 : Int) - 52)
      = ((min a.log2 b.log2 : Nat) : Int) - 52 := by omega
  rw [h1, h2, h3]
  have hN : a * 2 ^ (52 - a.log2) * 2 ^ (a.log2 - min a.log2 b.log2)
      + b * 2 ^ (52 - b.log2) * 2 ^ (b.log2 - min a.log2 b.log2)
      = (a + b) * 2 ^ (52 - min a.log2 b.log2) := by
    rw [Nat.mul_assoc, ← Nat.pow_add, Nat.mul_assoc, ← Nat.pow_add, Nat.add_mul]
    have e1 : 52 - a.log2 + (a.log2 - min a.log2 b.log2) = 52 - min a.log2 b.log2 := by omega
    have e2 : 52 - b.log2 + (b.log2 - min a.log2 b.log2) = 52 - min a.log2 b.log2 := by omega
    rw [e1, e2]
  rw [← Int.natCast_add, hN]
  have hNpos : 0 < (a + b) * 2 ^ (52 - min a.log2 b.log2) :=
    Nat.mul_pos (by omega) (Nat.two_pow_pos _)
  rw [normalize_eq_of_pos _ _ (Int.natCast_pos.mpr hNpos), Int.toNat_natCast]
  have hlog := log2_mul_pow (show 0 < a + b by omega) (52 - min a.log2 b.log2)
  have hg : grid ((a + b) * 2 ^ (52 - min a.log2 b.log2)) (((min a.log2 b.log2 : Nat) : Int) - 52)
      = ((a + b).log2 : Int) - 52 := by
    simp only [grid, totalExponent, hlog]; omega
  have hk : (grid ((a + b) * 2 ^ (52 - min a.log2 b.log2)) (((min a.log2 b.log2 : Nat) : Int) - 52)
      - (((min a.log2 b.log2 : Nat) : Int) - 52)).toNat = (a + b).log2 - min a.log2 b.log2 := by
    rw [hg]; omega
  have hj : ((((min a.log2 b.log2 : Nat) : Int) - 52)
      - grid ((a + b) * 2 ^ (52 - min a.log2 b.log2)) (((min a.log2 b.log2 : Nat) : Int) - 52)).toNat
      = 0 := by
    rw [hg]; omega
  have hle : (a + b).log2 - min a.log2 b.log2 ≤ 52 - min a.log2 b.log2 := by omega
  have hx : 52 - min a.log2 b.log2 - ((a + b).log2 - min a.log2 b.log2) = 52 - (a + b).log2 := by
    omega
  obtain ⟨hp, he⟩ := round_exact .positive hNpos _
    (by rw [hk]; exact mul_pow_mod_pow _ _ _ hle)
    (by rw [hk, hj, Nat.pow_zero, Nat.mul_one, mul_pow_div_pow _ _ _ hle, hx]
        exact safe_mantissa_lt _ hab)
  rw [he]
  exact finite_congr
    (by rw [hk, hj, Nat.pow_zero, Nat.mul_one, mul_pow_div_pow _ _ _ hle, hx]) hg

/-! ## The `Float` layer -/

theorem unpack_pack_safe (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) :
    unpack .binary64 (UnpackedFloat.pack .binary64 (safe n h0)) = safe n h0 := by
  have hl := log2_le_52 h
  exact unpack_pack_of_normal64 _ _ _ _ (safe_lo h0 h) (safe_mantissa_lt n h)
    (by omega) (by omega)

theorem safe_one : safe 1 Nat.one_pos = .finite .positive (2 ^ 52) (-52) (by decide) :=
  finite_congr rfl rfl

/-- The float `1.0`, as `Float.ofScientific`'s fast path spells it. -/
theorem one_unpack :
    unpack .binary64 (0x3FF0000000000000 : UInt64).toBitVec = safe 1 Nat.one_pos := by
  rw [safe_one]; rfl

/-- `Float.ofNat` of a safe positive integer is its canonical form packed. -/
theorem float_ofNat_safe (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) :
    Float.ofNat n = Float.ofModel (Float.Model.pack (safe n h0)) := by
  have hfast : n < 2 ^ 53 ∧ (0 : Nat) ≤ 22 := ⟨h, by omega⟩
  simp only [Float.ofNat, OfScientific.ofScientific, Float.ofScientific, hfast, and_self,
    ↓reduceDIte, Bool.false_eq_true, ↓reduceIte]
  show Float.ofModel (Float.Model.mul (Float.Model.ofUInt64 n.toUInt64)
    (Float.Model.ofBits 0x3FF0000000000000)) = _
  congr 1
  rw [Float.Model.mul, Float.Model.ofUInt64, Float.Model.ofBits, model_unpack_pack,
    model_unpack_pack, UnpackedFloat.ofUInt64, UnpackedFloat.ofNat, UnpackedFloat.ofInt,
    one_unpack, Nat.toUInt64_eq, UInt64.toNat_ofNat', Nat.mod_eq_of_lt (by omega),
    normalize_safe' n h0 h, unpack_pack_safe n h0 h, unpack_pack_safe 1 Nat.one_pos (by decide),
    mul_safe n 1 h0 Nat.one_pos (by omega)]
  congr 1
  exact finite_congr (by rw [Nat.mul_one]) (by rw [Nat.mul_one])

theorem float_ofNat_add (a b : Nat) (ha : 0 < a) (hb : 0 < b) (hab : a + b < 2 ^ 53) :
    Float.ofNat a + Float.ofNat b = Float.ofNat (a + b) := by
  rw [float_ofNat_safe a ha (by omega), float_ofNat_safe b hb (by omega),
    float_ofNat_safe (a + b) (by omega) hab]
  show Float.ofModel (Float.Model.add _ _) = _
  congr 1
  rw [Float.Model.add, model_unpack_pack, model_unpack_pack, unpack_pack_safe a ha (by omega),
    unpack_pack_safe b hb (by omega), add_safe a b ha hb hab]

theorem float_ofNat_mul (a b : Nat) (ha : 0 < a) (hb : 0 < b) (hab : a * b < 2 ^ 53) :
    Float.ofNat a * Float.ofNat b = Float.ofNat (a * b) := by
  have ha' : a < 2 ^ 53 := by have := Nat.le_mul_of_pos_right a hb; omega
  have hb' : b < 2 ^ 53 := by have := Nat.le_mul_of_pos_left b ha; omega
  rw [float_ofNat_safe a ha ha', float_ofNat_safe b hb hb',
    float_ofNat_safe (a * b) (Nat.mul_pos ha hb) hab]
  show Float.ofModel (Float.Model.mul _ _) = _
  congr 1
  rw [Float.Model.mul, model_unpack_pack, model_unpack_pack, unpack_pack_safe a ha ha',
    unpack_pack_safe b hb hb', mul_safe a b ha hb hab]

theorem float_ofNat_ne_nan (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) :
    (Float.ofNat n).toModel.unpack ≠ .notANumber := by
  rw [float_ofNat_safe n h0 h]
  show unpack .binary64 (UnpackedFloat.pack .binary64 (safe n h0)) ≠ _
  rw [unpack_pack_safe n h0 h]
  simp [safe]

/-! ## Exact division -/

theorem log2_mul_le_succ (b c : Nat) (hb : 0 < b) (hc : 0 < c) :
    (b * c).log2 ≤ b.log2 + c.log2 + 1 := by
  have h1 : b < 2 ^ (b.log2 + 1) := Nat.lt_log2_self
  have h2 : c < 2 ^ (c.log2 + 1) := Nat.lt_log2_self
  have h3 : b * c < 2 ^ (b.log2 + c.log2 + 2) := by
    calc b * c < 2 ^ (b.log2 + 1) * 2 ^ (c.log2 + 1) := Nat.mul_lt_mul'' h1 h2
      _ = 2 ^ (b.log2 + c.log2 + 2) := by rw [← Nat.pow_add]; congr 1; omega
  rcases Nat.lt_or_ge (b.log2 + c.log2 + 1) (b * c).log2 with hc' | hc'
  · have h4 := Nat.log2_self_le (Nat.pos_iff_ne_zero.mp (Nat.mul_pos hb hc))
    have h5 : 2 ^ (b.log2 + c.log2 + 2) ≤ 2 ^ (b * c).log2 :=
      Nat.pow_le_pow_right (by omega) (by omega)
    omega
  · exact hc'

theorem accuracyOfFraction_zero (d : Nat) : accuracyOfFraction 0 d = accuracyOfFraction 0 1 := by
  simp [accuracyOfFraction]

theorem sign_pos_div_pos : Sign.positive / Sign.positive = Sign.positive := rfl

/-- The quotient of two safe integers that divides exactly is exact. -/
theorem div_safe (b c : Nat) (hb : 0 < b) (hc : 0 < c) (hbc : b * c < 2 ^ 53) :
    UnpackedFloat.div .binary64 (safe (b * c) (Nat.mul_pos hb hc)) (safe b hb) = safe c hc := by
  have hb' : b < 2 ^ 53 := by have := Nat.le_mul_of_pos_right b hc; omega
  have hc' : c < 2 ^ 53 := by have := Nat.le_mul_of_pos_left c hb; omega
  have hlb := log2_le_52 hb'
  have hlc := log2_le_52 hc'
  have hlbc := log2_le_52 hbc
  have hsum : b.log2 + c.log2 ≤ (b * c).log2 := by
    apply (Nat.le_log2 (Nat.pos_iff_ne_zero.mp (Nat.mul_pos hb hc))).mpr
    rw [Nat.pow_add]
    exact Nat.mul_le_mul (Nat.log2_self_le (Nat.pos_iff_ne_zero.mp hb))
      (Nat.log2_self_le (Nat.pos_iff_ne_zero.mp hc))
  have hup := log2_mul_le_succ b c hb hc
  have hl1 : (b * c * 2 ^ (52 - (b * c).log2)).log2 = 52 := by
    rw [log2_mul_pow (Nat.mul_pos hb hc)]; omega
  have hl2 : (b * 2 ^ (52 - b.log2)).log2 = 52 := by
    rw [log2_mul_pow hb]; omega
  simp only [safe, UnpackedFloat.div, divCore, sign_pos_div_pos, totalExponent, hl1, hl2,
    targetExponent_binary64]
  have ht : min (((b * c).log2 : Int) - 52 - ((b.log2 : Int) - 52))
      (max ((52 : Nat) + 1 + (((b * c).log2 : Int) - 52) - ((52 : Nat) + 1 + ((b.log2 : Int) - 52)) - 53)
        (-1074)) = ((b * c).log2 : Int) - b.log2 - 53 := by
    rw [Int.max_def]; split <;> omega
  rw [ht]
  have hs : (((b * c).log2 : Int) - 52 - ((b.log2 : Int) - 52)
      - (((b * c).log2 : Int) - b.log2 - 53)).toNat = 53 := by omega
  rw [hs, Nat.shiftLeft_eq]
  have hexp : 52 - (b * c).log2 + 53 = (53 - (b * c).log2 + b.log2) + (52 - b.log2) := by omega
  have hm : b * c * 2 ^ (52 - (b * c).log2) * 2 ^ 53
      = c * 2 ^ (53 - (b * c).log2 + b.log2) * (b * 2 ^ (52 - b.log2)) := by
    rw [Nat.mul_assoc (b * c), ← Nat.pow_add, hexp, Nat.pow_add, Nat.mul_comm b c,
      Nat.mul_mul_mul_comm]
  rw [hm, Nat.mul_div_cancel _ (Nat.mul_pos hb (Nat.two_pow_pos _)),
    Nat.mul_mod_left, accuracyOfFraction_zero]
  have hlog := log2_mul_pow hc (53 - (b * c).log2 + b.log2)
  have hg : grid (c * 2 ^ (53 - (b * c).log2 + b.log2)) (((b * c).log2 : Int) - b.log2 - 53)
      = (c.log2 : Int) - 52 := by
    simp only [grid, totalExponent, hlog]; omega
  have hk : (grid (c * 2 ^ (53 - (b * c).log2 + b.log2)) (((b * c).log2 : Int) - b.log2 - 53)
      - (((b * c).log2 : Int) - b.log2 - 53)).toNat = c.log2 + b.log2 + 1 - (b * c).log2 := by
    rw [hg]; omega
  have hle : c.log2 + b.log2 + 1 - (b * c).log2 ≤ 53 - (b * c).log2 + b.log2 := by omega
  have hx : 53 - (b * c).log2 + b.log2 - (c.log2 + b.log2 + 1 - (b * c).log2) = 52 - c.log2 := by
    omega
  have hw : WellPlaced (c * 2 ^ (53 - (b * c).log2 + b.log2)) (((b * c).log2 : Int) - b.log2 - 53) := by
    unfold WellPlaced; rw [hg]; omega
  rw [roundWA_exact _ _ _ hw (by rw [hk]; exact mul_pow_mod_pow _ _ _ hle)
    (by rw [hk, mul_pow_div_pow _ _ _ hle]; exact Nat.mul_pos hc (Nat.two_pow_pos _))
    (by rw [hk, mul_pow_div_pow _ _ _ hle, hx]; exact safe_mantissa_lt c hc')]
  exact finite_congr (by rw [hk, mul_pow_div_pow _ _ _ hle, hx]) hg

theorem float_ofNat_div (b c : Nat) (hb : 0 < b) (hc : 0 < c) (hbc : b * c < 2 ^ 53) :
    Float.ofNat (b * c) / Float.ofNat b = Float.ofNat c := by
  have hb' : b < 2 ^ 53 := by have := Nat.le_mul_of_pos_right b hc; omega
  have hc' : c < 2 ^ 53 := by have := Nat.le_mul_of_pos_left c hb; omega
  rw [float_ofNat_safe (b * c) (Nat.mul_pos hb hc) hbc, float_ofNat_safe b hb hb',
    float_ofNat_safe c hc hc']
  show Float.ofModel (Float.Model.div _ _) = _
  congr 1
  rw [Float.Model.div, model_unpack_pack, model_unpack_pack,
    unpack_pack_safe (b * c) (Nat.mul_pos hb hc) hbc, unpack_pack_safe b hb hb',
    div_safe b c hb hc hbc]

/-! ## Zero, and `Float.ofNat` as one canonical unpacked value -/

theorem float_ofNat_zero : Float.ofNat 0 = Float.ofModel (Float.Model.pack (.zero .positive)) := rfl

theorem canonical_safe (n : Nat) (h0 : 0 < n) (h : n < 2 ^ 53) : Canonical (safe n h0) := by
  have hl := log2_le_52 h
  exact .normal _ _ _ _ (safe_lo h0 h) (safe_mantissa_lt n h) (by omega) (by omega)

theorem then_eq_eq (o p : Ordering) : o.then p = .eq ↔ o = .eq ∧ p = .eq := by
  cases o <;> cases p <;> decide

/-- `Float.beq` of two safe floats, as the model's own comparison spells
it once both are unpacked. -/
theorem float_beq_unfold (u v : UnpackedFloat) :
    Float.beq (Float.ofModel (Float.Model.pack u)) (Float.ofModel (Float.Model.pack v))
      = ((Float.Model.pack u).unpack.compare (Float.Model.pack v).unpack == some .eq) := rfl

theorem float_beq_ofNat (a b : Nat) (ha : a < 2 ^ 53) (hb : b < 2 ^ 53) :
    (Float.beq (Float.ofNat a) (Float.ofNat b) = true) ↔ a = b := by
  rcases Nat.eq_zero_or_pos a with rfl | ha0
  · rcases Nat.eq_zero_or_pos b with rfl | hb0
    · exact ⟨fun _ => rfl, fun _ => by decide⟩
    · rw [float_ofNat_zero, float_ofNat_safe b hb0 hb, float_beq_unfold, model_unpack_pack,
        model_unpack_pack, unpack_pack_of_canonical (.zero _), unpack_pack_safe b hb0 hb]
      simp only [safe, UnpackedFloat.compare]
      constructor
      · intro h; exact absurd h (by decide)
      · intro h; omega
  · rcases Nat.eq_zero_or_pos b with rfl | hb0
    · rw [float_ofNat_zero, float_ofNat_safe a ha0 ha, float_beq_unfold, model_unpack_pack,
        model_unpack_pack, unpack_pack_of_canonical (.zero _), unpack_pack_safe a ha0 ha]
      simp only [safe, UnpackedFloat.compare]
      constructor
      · intro h; exact absurd h (by decide)
      · intro h; omega
    · rw [float_ofNat_safe a ha0 ha, float_ofNat_safe b hb0 hb, float_beq_unfold,
        model_unpack_pack, model_unpack_pack, unpack_pack_safe a ha0 ha, unpack_pack_safe b hb0 hb]
      simp only [safe, UnpackedFloat.compare, beq_iff_eq, Option.some.injEq, then_eq_eq,
        Int.compare_eq_eq, Nat.compare_eq_eq]
      constructor
      · rintro ⟨he, hm⟩
        have hl : a.log2 = b.log2 := by omega
        rw [hl] at hm
        exact Nat.eq_of_mul_eq_mul_right (Nat.two_pow_pos _) hm
      · rintro rfl
        exact ⟨rfl, rfl⟩

theorem float_ofNat_add' (a b : Nat) (h : a + b < 2 ^ 53) :
    Float.ofNat a + Float.ofNat b = Float.ofNat (a + b) := by
  have ha' : a < 2 ^ 53 := by omega
  have hb' : b < 2 ^ 53 := by omega
  rcases Nat.eq_zero_or_pos a with rfl | ha
  · rcases Nat.eq_zero_or_pos b with rfl | hb
    · rfl
    · rw [Nat.zero_add, float_ofNat_zero, float_ofNat_safe b hb hb']
      show Float.ofModel (Float.Model.add _ _) = _
      congr 1
      rw [Float.Model.add, model_unpack_pack, model_unpack_pack,
        unpack_pack_of_canonical (.zero _), unpack_pack_safe b hb hb']
      simp [UnpackedFloat.add, safe]
  · rcases Nat.eq_zero_or_pos b with rfl | hb
    · rw [Nat.add_zero, float_ofNat_zero, float_ofNat_safe a ha ha']
      show Float.ofModel (Float.Model.add _ _) = _
      congr 1
      rw [Float.Model.add, model_unpack_pack, model_unpack_pack,
        unpack_pack_of_canonical (.zero _), unpack_pack_safe a ha ha']
      simp [UnpackedFloat.add, safe]
    · exact float_ofNat_add a b ha hb h

theorem float_ofNat_mul' (a b : Nat) (ha' : a < 2 ^ 53) (hb' : b < 2 ^ 53) (h : a * b < 2 ^ 53) :
    Float.ofNat a * Float.ofNat b = Float.ofNat (a * b) := by
  rcases Nat.eq_zero_or_pos a with rfl | ha
  · rcases Nat.eq_zero_or_pos b with rfl | hb
    · rfl
    · rw [Nat.zero_mul, float_ofNat_zero, float_ofNat_safe b hb hb']
      show Float.ofModel (Float.Model.mul _ _) = _
      congr 1
      rw [Float.Model.mul, model_unpack_pack, model_unpack_pack,
        unpack_pack_of_canonical (.zero _), unpack_pack_safe b hb hb']
      simp [UnpackedFloat.mul, safe, sign_pos_mul_pos]
  · rcases Nat.eq_zero_or_pos b with rfl | hb
    · rw [Nat.mul_zero, float_ofNat_zero, float_ofNat_safe a ha ha']
      show Float.ofModel (Float.Model.mul _ _) = _
      congr 1
      rw [Float.Model.mul, model_unpack_pack, model_unpack_pack,
        unpack_pack_of_canonical (.zero _), unpack_pack_safe a ha ha']
      simp [UnpackedFloat.mul, safe, sign_pos_mul_pos]
    · exact float_ofNat_mul a b ha hb h

theorem float_ofNat_div' (a b : Nat) (hb : 0 < b) (hb' : b < 2 ^ 53) (hd : b ∣ a)
    (ha : a < 2 ^ 53) : Float.ofNat a / Float.ofNat b = Float.ofNat (a / b) := by
  obtain ⟨c, rfl⟩ := hd
  rcases Nat.eq_zero_or_pos c with rfl | hc
  · rw [Nat.mul_zero, Nat.zero_div, float_ofNat_zero, float_ofNat_safe b hb hb']
    show Float.ofModel (Float.Model.div _ _) = _
    congr 1
    rw [Float.Model.div, model_unpack_pack, model_unpack_pack,
      unpack_pack_of_canonical (.zero _), unpack_pack_safe b hb hb']
    simp [UnpackedFloat.div, safe, sign_pos_div_pos]
  · rw [Nat.mul_div_cancel_left c hb]
    exact float_ofNat_div b c hb hc ha

/-! ## The `Int` layer, as a residual goal spells it -/

theorem ofInt_add (a b : Int) (ha : 0 ≤ a) (hb : 0 ≤ b) (h : a + b < 9007199254740992) :
    Float.ofInt a + Float.ofInt b = Float.ofInt (a + b) := by
  obtain ⟨m, rfl⟩ : ∃ m : Nat, a = m := ⟨a.toNat, by omega⟩
  obtain ⟨n, rfl⟩ : ∃ n : Nat, b = n := ⟨b.toNat, by omega⟩
  exact float_ofNat_add' m n (by omega)

theorem ofInt_mul (a b : Int) (ha : 0 ≤ a) (hb : 0 ≤ b)
    (ha' : a < 9007199254740992) (hb' : b < 9007199254740992) (h : a * b < 9007199254740992) :
    Float.ofInt a * Float.ofInt b = Float.ofInt (a * b) := by
  obtain ⟨m, rfl⟩ : ∃ m : Nat, a = m := ⟨a.toNat, by omega⟩
  obtain ⟨n, rfl⟩ : ∃ n : Nat, b = n := ⟨b.toNat, by omega⟩
  exact float_ofNat_mul' m n (by omega) (by omega) (by rw [← Int.natCast_mul] at h; omega)

theorem ofInt_div (a b : Int) (ha : 0 ≤ a) (hb : 0 < b) (hb' : b < 9007199254740992)
    (hd : b ∣ a) (h : a < 9007199254740992) :
    Float.ofInt a / Float.ofInt b = Float.ofInt (a / b) := by
  obtain ⟨m, rfl⟩ : ∃ m : Nat, a = m := ⟨a.toNat, by omega⟩
  obtain ⟨n, rfl⟩ : ∃ n : Nat, b = n := ⟨b.toNat, by omega⟩
  rw [← Int.natCast_ediv]
  exact float_ofNat_div' m n (by omega) (by omega) (Int.natCast_dvd_natCast.mp hd) (by omega)

theorem beq_ofInt (a b : Int) (ha : 0 ≤ a) (hb : 0 ≤ b)
    (ha' : a < 9007199254740992) (hb' : b < 9007199254740992) :
    (Float.beq (Float.ofInt a) (Float.ofInt b) = true) ↔ a = b := by
  obtain ⟨m, rfl⟩ : ∃ m : Nat, a = m := ⟨a.toNat, by omega⟩
  obtain ⟨n, rfl⟩ : ∃ n : Nat, b = n := ⟨b.toNat, by omega⟩
  show (Float.beq (Float.ofNat m) (Float.ofNat n) = true) ↔ (m : Int) = n
  rw [float_beq_ofNat m n (by omega) (by omega)]
  omega

/-- A `Float` literal is the integer it spells. -/
theorem float_lit (n : Nat) : (OfNat.ofNat n : Float) = Float.ofInt (OfNat.ofNat n) := rfl

attribute [grind =] ofInt_add ofInt_mul ofInt_div beq_ofInt float_lit

end Js.Number.FloatFacts
