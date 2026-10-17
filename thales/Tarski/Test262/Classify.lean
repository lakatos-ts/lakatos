import Tarski.Test262.Pool

/-! One child's answer as an outcome.

The binary's contract is `Tarski/Main.lean`'s header: 0 ran, 1 uncaught,
2 bad input, 3 unsupported, and a wall clock for divergence. Every class
here is one of those, plus the two the runner itself produces: a timeout
it imposed, and its own machinery failing. -/

namespace Tarski.Test262

/-- What a test run came to. -/
inductive Outcome where
  | pass
  | fail (detail : String)
  | unsupported (kind : String)
  | timeout
  | harnessError (detail : String)
deriving Repr, BEq, Inhabited

/-- The first line of a report, which is where the binary puts the summary. -/
def firstLine (stderr : String) : String :=
  (stderr.splitOn "\n").headD ""

/-- `^Uncaught ([A-Za-z_$][\w$]*)(?::|$)`: the class of an uncaught error,
none when the report carries no name (a thrown primitive, or `Uncaught: …`). -/
def thrownClass (stderr : String) : Option String :=
  let line := firstLine stderr
  if !line.startsWith "Uncaught " then none else
  let rest := (line.toList.drop "Uncaught ".length)
  let word (c : Char) := c.isAlphanum || c == '_' || c == '$'
  let name := rest.takeWhile word
  match name, rest.drop name.length with
  | first :: _, after =>
    if first.isDigit then none
    else if after.isEmpty || after.head? == some ':' then some (String.ofList name)
    else none
  | [], _ => none

/-- What the binary said was unsupported, or the whole line if it did not say. -/
def unsupportedKind (stderr : String) : String :=
  let line := firstLine stderr
  match line.splitOn "unsupported: " with
  | _ :: rest@(_ :: _) => "unsupported: ".intercalate rest
  | _ => line

/-- A death by signal, read off the 128-plus-signal status. The binary
only ever exits 0 to 3, so nothing it chooses lands here. -/
def signaled (status : UInt32) : Bool := 128 < status && status ≤ 128 + 64

/-- One child's answer as an outcome. `negative` is the class a
runtime-phase negative test must end with. -/
def classify (r : Spawned) (negative : Option String) : Outcome :=
  -- A killed process is the timeout the runner imposed; a child killed by
  -- any other signal reads the same, as it did under `spawnSync`.
  if r.timedOut || (r.status.map signaled).getD false then .timeout
  else if let some e := r.failedToStart then .harnessError e
  else match r.status with
  | some 3 => .unsupported (unsupportedKind r.stderr)
  | some 0 =>
    match negative with
    | none => .pass
    | some t => .fail s!"expected an uncaught {t}, the script completed"
  | some 1 =>
    match negative with
    | none => .fail (firstLine r.stderr)
    | some t =>
      if thrownClass r.stderr == some t then .pass
      else .fail s!"expected an uncaught {t}, got {firstLine r.stderr}"
  -- Exit 2 is the binary refusing its input, and any other status a binary
  -- this runner does not know: both are its own machinery, not the test's.
  | status =>
    let line := firstLine r.stderr
    .harnessError (if line.isEmpty then s!"exit {(status.map toString).getD "null"}" else line)

end Tarski.Test262
