import Thales.Admit

open Thales Tarski.Lemma

def ann (fn p : String) (line : Nat) (o : Outcome) : Annotation := ⟨fn, p, line, o⟩
def emission : Lean.Json := Lean.Json.mkObj [("emission", Lean.Json.mkObj [("obligations", Lean.Json.arr #[])])]
def prog (file : String) (as : Array Annotation) : Document := .program file true emission as
def gateDoc (file reason message : String) (as : Array Annotation) (ds : Array Diagnostic := #[]) : Document :=
  .refused file true reason message ds Lean.Json.null as
def outside (file : String) : String :=
  s!"{file} is not part of the program tsconfig.json describes, so it was not type checked"
def outsideDoc (file : String) (as : Array Annotation) : Document :=
  gateDoc file "outside-program" (outside file) as

-- A program file partitions into tried, classified, and refusals.
#guard match admit false #[prog "a.ts" #[ann "f" "p" 1 .tried, ann "g" "q" 2 (.classified "Inappropriate" none "async"),
    ann "h" "r" 3 (.refused "typing" "a.ts:3: no"), ann "k" "s" 4 (.refused "extraction" "a.ts:4: dup")]] with
  | .admitted notes files gate typing =>
    notes == #[⟨true, "a.ts:3: no"⟩] && gate.isEmpty &&
    files.size == 1 && files[0]!.tried == #[⟨"a.ts", "f", "p"⟩] &&
    files[0]!.classified == #[⟨⟨"a.ts", "g", "q"⟩, .classified .Inappropriate none "async"⟩] &&
    files[0]!.extractionRefusals == #[⟨⟨"a.ts", "k", "s"⟩, .inputError "a.ts:4: dup"⟩] &&
    files[0]!.emission.isSome &&
    typing == #[⟨⟨"a.ts", "h", "r"⟩, .inputError "a.ts:3: no"⟩]
  | _ => false

-- A classified Error is an engine failure in `error`.
#guard classifiedResult "Error" none "broke" == .error "broke"
#guard classifiedResult "NotTried" (some "unsupported-range") "big" == .classified .NotTried (some "unsupported-range") "big"
#guard classifiedResult "Bogus" none "r" == .error "unknown classified status 'Bogus'"

-- An outside-program file beside a program file: the note, the gate refusals first.
#guard match admit true #[outsideDoc "o.mts"
      #[ann "o" "p" 1 (.refused "gate" (outside "o.mts")), ann "o" "x" 2 (.refused "extraction" "o.mts:2: bad")],
    prog "a.ts" #[ann "f" "p" 1 .tried]] with
  | .admitted notes files gate _ =>
    notes == #[⟨false, "no files given; discovered 2 file(s) via tsconfig.json"⟩,
               ⟨true, outside "o.mts"⟩, ⟨true, "o.mts:2: bad"⟩] &&
    files.map (·.file) == #["a.ts"] &&
    gate.map (·.result) == #[.inputError (outside "o.mts"), .inputError "o.mts:2: bad"]
  | _ => false

-- Two outside files: every outside note first, then each one's extraction echoes;
-- the typing echoes come last.
#guard match admit false #[
    outsideDoc "o1.ts" #[ann "a" "p" 1 (.refused "gate" (outside "o1.ts")), ann "a" "x" 2 (.refused "extraction" "o1.ts:2: bad")],
    prog "a.ts" #[ann "f" "p" 1 (.refused "typing" "a.ts:1: typed")],
    outsideDoc "o2.ts" #[ann "b" "p" 1 (.refused "gate" (outside "o2.ts")), ann "b" "x" 2 (.refused "extraction" "o2.ts:2: bad")]] with
  | .admitted notes _ gate typing =>
    notes == #[⟨true, outside "o1.ts"⟩, ⟨true, outside "o2.ts"⟩,
               ⟨true, "o1.ts:2: bad"⟩, ⟨true, "o2.ts:2: bad"⟩, ⟨true, "a.ts:1: typed"⟩] &&
    gate.map (·.identity.file) == #["o1.ts", "o1.ts", "o2.ts", "o2.ts"] &&
    typing.size == 1
  | _ => false

-- A syntax refusal after the gate keeps its emission and is planned.
#guard match admit false #[.refused "s.ts" true "syntax" "Unexpected token" #[] emission #[ann "f" "p" 1 .tried]] with
  | .admitted notes files _ _ => notes.isEmpty && files.map (·.file) == #["s.ts"] && files[0]!.tried.size == 1
  | _ => false

-- Every file refused by the type check: diagnostics once, extraction echoes, the count.
#guard match admit false #[
    gateDoc "a.ts" "typecheck" "m" #[ann "f" "p" 2 (.refused "gate" "the program does not type check: a.ts:1: TS2322: no")] #[⟨some "a.ts", some 1, 2322, "no"⟩],
    gateDoc "b.ts" "typecheck" "m" #[ann "g" "p" 1 (.refused "gate" "the program does not type check: a.ts:1: TS2322: no"), ann "g" "p" 2 (.refused "extraction" "b.ts:2: dup")] #[⟨some "a.ts", some 1, 2322, "no"⟩]] with
  | .refused notes refusals =>
    notes == #[⟨true, "a.ts:1: TS2322: no"⟩, ⟨true, "b.ts:2: dup"⟩,
               ⟨false, "the program does not type check under lakatos's required options; reporting 3 annotations as InputError"⟩] &&
    refusals.map (·.identity.function) == #["f", "g", "g"] &&
    refusals[2]!.result == .inputError "b.ts:2: dup"
  | _ => false

-- No tsconfig, after discovery: the gate refusals of all files, then the extraction ones.
#guard match admit true #[
    gateDoc "a.ts" "no-tsconfig" "m" #[ann "f" "p" 1 (.refused "gate" "nt"), ann "f" "x" 2 (.refused "extraction" "a.ts:2: bad")],
    gateDoc "b.ts" "no-tsconfig" "m" #[ann "g" "p" 1 (.refused "gate" "nt")]] with
  | .refused notes refusals =>
    notes == #[⟨false, "no files given; discovered 2 file(s) via tsconfig.json"⟩, ⟨true, "a.ts:2: bad"⟩,
               ⟨false, "no tsconfig.json; reporting 3 annotations as InputError"⟩] &&
    refusals.map (fun r => (r.identity.function, r.identity.property)) == #[("f", "p"), ("g", "p"), ("f", "x")]
  | _ => false

#guard match admit false #[gateDoc "a.ts" "no-tsconfig" "m" #[ann "f" "p" 1 (.refused "gate" "nt")]] with
  | .refused notes _ => notes == #[⟨false, "no tsconfig.json; reporting 1 annotation as InputError"⟩]
  | _ => false

-- A formula Lemma cannot read aborts the run.
#guard match admit false #[prog "a.ts" #[], gateDoc "b.ts" "annotation" "b.ts:1: @ensures{p}: unexpected token" #[]] with
  | .abort notes m => notes.isEmpty && m == "b.ts:1: @ensures{p}: unexpected token"
  | _ => false

-- The notes made before the abort still go out: discovery and the outside files, not typing.
#guard match admit true #[prog "a.ts" #[ann "f" "p" 1 (.refused "typing" "a.ts:1: typed")],
    gateDoc "b.ts" "annotation" "b.ts:1: bad" #[],
    outsideDoc "o.ts" #[ann "o" "x" 2 (.refused "extraction" "o.ts:2: bad")]] with
  | .abort notes m =>
    notes == #[⟨false, "no files given; discovered 3 file(s) via tsconfig.json"⟩,
               ⟨true, outside "o.ts"⟩, ⟨true, "o.ts:2: bad"⟩] && m == "b.ts:1: bad"
  | _ => false

#guard pluralAnnotations 1 == "1 annotation"
#guard pluralAnnotations 0 == "0 annotations"
