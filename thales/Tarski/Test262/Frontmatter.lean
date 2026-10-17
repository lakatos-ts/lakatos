/-! test262's YAML front matter, the four keys the runner reads.

The block is `/*---` … `---*/`. Nothing here is a YAML parser: the suite's
front matter is a small regular subset — top-level keys at column 0, lists
flow (`[a.js, b.js]`) or block (`  - Symbol`), `negative` a two-key map,
and `info`/`description` block scalars skipped whole by indentation, so a
block scalar can say anything, including something that looks like a key.

The line rules transcribe the regular expressions the TypeScript runner
used, JavaScript's `\s` and line terminators included. -/

namespace Tarski.Test262

/-- `negative`: the phase at which, and the class with which, the test must fail. -/
structure Negative where
  phase : String
  type : String
deriving Repr, BEq, Inhabited

/-- The four front-matter keys that decide how a test is run. Absent and
empty mean the same thing to every decision the runner makes. -/
structure FrontMatter where
  includes : Array String := #[]
  flags : Array String := #[]
  features : Array String := #[]
  negative : Option Negative := none
deriving Repr, BEq, Inhabited

/-- JavaScript's `\s`: WhiteSpace and LineTerminator. -/
def jsSpace (c : Char) : Bool :=
  c == ' ' || c == '\t' || c == '\n' || c == '\r' || c.val == 0x0B || c.val == 0x0C ||
  c.val == 0xA0 || c.val == 0x1680 || (0x2000 ≤ c.val && c.val ≤ 0x200A) ||
  c.val == 0x2028 || c.val == 0x2029 || c.val == 0x202F || c.val == 0x205F ||
  c.val == 0x3000 || c.val == 0xFEFF

/-- What `.` in a JavaScript regular expression does not match. -/
def lineTerminator (c : Char) : Bool :=
  c == '\n' || c == '\r' || c.val == 0x2028 || c.val == 0x2029

/-- `String.prototype.trim`. -/
def trim (s : String) : String :=
  String.ofList ((s.toList.dropWhile jsSpace).reverse.dropWhile jsSpace).reverse

/-- The `/*---` … `---*/` block's contents, or none when there is none. -/
def block (source : String) : Option String :=
  match source.splitOn "/*---" with
  | [] | [_] => none
  | _ :: rest =>
    match ("/*---".intercalate rest).splitOn "---*/" with
    | [] | [_] => none
    | body :: _ => some body

/-- A list item or scalar with a trailing ` # comment` dropped. -/
def uncomment (text : String) : String :=
  trim ((text.splitOn " #").headD text)

/-- A flow list, `[a.js, b.js]` or `[]`. -/
def flowList (text : String) : Array String :=
  let cs := text.toList
  let cs := match cs with | '[' :: rest => rest | _ => cs
  let cs := match cs.reverse with | ']' :: rest => rest.reverse | _ => cs
  ((String.ofList cs).splitOn ",").toArray.map uncomment |>.filter (!·.isEmpty)

/-- `(.*)$` after `\s*`: the rest with leading space dropped, or none when a
line terminator is left in it. -/
def restOfLine? (cs : List Char) : Option String :=
  let v := cs.dropWhile jsSpace
  if v.any lineTerminator then none else some (String.ofList v)

/-- `^([A-Za-z_]+):\s*(.*)$`: a key and its value. -/
def keyLine? (line : String) : Option (String × String) :=
  let cs := line.toList
  let name := cs.takeWhile fun c => c.isAlpha || c == '_'
  if name.isEmpty then none
  else match cs.drop name.length with
    | ':' :: rest => (restOfLine? rest).map (String.ofList name, ·)
    | _ => none

/-- `^\s+` and the rest, or none when the line does not start with space. -/
def indentedRest? (line : String) : Option (List Char) :=
  let cs := line.toList
  let rest := cs.dropWhile jsSpace
  if rest.length == cs.length then none else some rest

/-- The lines indented under the key at `index`, up to the next column-0 key. -/
def indented (lines : Array String) (index : Nat) : Array String := Id.run do
  let mut out := #[]
  for line in lines.extract (index + 1) lines.size do
    if (trim line).isEmpty then continue
    match line.toList with
    | c :: _ => if !jsSpace c then break
    | [] => break
    out := out.push line
  return out

/-- `^\s+-\s*(.*)$`: a block list's items, up to the first line that is not one. -/
def blockList (lines : Array String) (index : Nat) : Array String := Id.run do
  let mut out := #[]
  for line in indented lines index do
    match indentedRest? line with
    | some ('-' :: rest) =>
      match restOfLine? rest with
      | some item => out := out.push (uncomment item)
      | none => break
    | _ => break
  return out

/-- `negative`'s two indented entries, both required. -/
def negativeMap (lines : Array String) (index : Nat) : Option Negative := Id.run do
  let mut phase : Option String := none
  let mut type : Option String := none
  for line in indented lines index do
    let some rest := indentedRest? line | continue
    let some (key, value) := keyLine? (String.ofList rest) | continue
    if key == "phase" then phase := some (uncomment value)
    if key == "type" then type := some (uncomment value)
  match phase, type with
  | some p, some t => return some { phase := p, type := t }
  | _, _ => return none

/-- The front matter of one test. A file with no block, or a key missing,
gets the empty answer for that key. -/
def parseFrontMatter (source : String) : FrontMatter := Id.run do
  let some text := block source | return {}
  let lines := (text.splitOn "\n").toArray
  let mut front : FrontMatter := {}
  for h : index in [0:lines.size] do
    -- Column 0, so a block scalar's indented prose is never a key.
    let some (name, raw) := keyLine? lines[index] | continue
    let value := uncomment raw
    let list := if value.isEmpty then blockList lines index else flowList value
    if name == "includes" then front := { front with includes := list }
    else if name == "flags" then front := { front with flags := list }
    else if name == "features" then front := { front with features := list }
    else if name == "negative" then
      if let some n := negativeMap lines index then front := { front with negative := some n }
  return front

end Tarski.Test262
