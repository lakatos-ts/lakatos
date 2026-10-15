import Lean.Data.Json

/-! JSON as the envelope prints it.

The envelope is read by people and diffed by tools, so its bytes are part
of the contract: fields in the order the envelope schema lists them,
printed the way `JSON.stringify(value, null, 2)` prints. `Lean.Json`
keeps an object's fields sorted, so the envelope is built in `Out`, which
keeps them in the order they were written, and a `Lean.Json` read off the
wire — a counterexample, sorted by the engine that printed it — converts
into it as is. -/

namespace Thales

open Lean

/-- A JSON value whose objects keep their fields in the order given. -/
inductive Out where
  | null
  | bool (b : Bool)
  | num (n : JsonNumber)
  | str (s : String)
  | arr (items : Array Out)
  | obj (fields : Array (String × Out))
  deriving Inhabited, BEq

/-- `Lean.Json` as `Out`: an object's fields in `Lean.Json`'s own order,
which is sorted by key. -/
partial def Out.ofJson : Json → Out
  | .null => .null
  | .bool b => .bool b
  | .num n => .num n
  | .str s => .str s
  | .arr items => .arr (items.map Out.ofJson)
  | .obj kvs => .obj (kvs.foldl (fun acc k v => acc.push (k, Out.ofJson v)) #[])

instance : Coe String Out := ⟨.str⟩

/-- An integer as a JSON number. -/
def Out.int (i : Int) : Out := .num (JsonNumber.fromInt i)

/-- A string as `JSON.stringify` quotes it: the quote, the backslash, and
the C0 controls escaped (the five with a short form by it, the rest as
`\u00xx` in lowercase hex), everything else as itself. -/
def quote (s : String) : String :=
  let hex (n : Nat) : Char := "0123456789abcdef".toList[n]!
  let escape (acc : String) (c : Char) : String :=
    match c with
    | '"' => acc ++ "\\\""
    | '\\' => acc ++ "\\\\"
    | '\x08' => acc ++ "\\b"
    | '\x0c' => acc ++ "\\f"
    | '\n' => acc ++ "\\n"
    | '\r' => acc ++ "\\r"
    | '\t' => acc ++ "\\t"
    | c =>
      if c.toNat < 0x20 then
        acc ++ "\\u00" ++ (hex (c.toNat / 16)).toString ++ (hex (c.toNat % 16)).toString
      else acc.push c
  (s.foldl escape "\"").push '"'

/-- A number as the envelope prints it. The numbers an envelope holds are
integers inside JavaScript's safe range (the engine sends any other
counterexample value as a decimal string), and those print as JavaScript
prints them, integral values bare whatever their spelling on the wire.
Anything else — an exponent JavaScript would keep, a value past a double
— no engine sends, and it prints by Lean's rules. -/
def number (n : JsonNumber) : String :=
  -- The value is `mantissa / 10^exponent`, so `1.0` is `⟨10, 1⟩`.
  let scale : Int := 10 ^ n.exponent
  if n.mantissa % scale == 0 then toString (n.mantissa / scale) else toString n

/-- `JSON.stringify(value)`: no whitespace at all. -/
partial def Out.compact : Out → String
  | .null => "null"
  | .bool b => toString b
  | .num n => number n
  | .str s => quote s
  | .arr items => "[" ++ ",".intercalate (items.map Out.compact).toList ++ "]"
  | .obj fields =>
    "{" ++ ",".intercalate (fields.map fun (k, v) => quote k ++ ":" ++ v.compact).toList ++ "}"

/-- `JSON.stringify(value, null, 2)`: one item or field per line, two
spaces deeper per level, and an empty array or object on its own line as
`[]` or `{}`. -/
partial def Out.pretty (v : Out) (indent : String := "") : String :=
  let inner := indent ++ "  "
  match v with
  | .arr items =>
    if items.isEmpty then "[]"
    else "[\n" ++ ",\n".intercalate (items.map fun i => inner ++ i.pretty inner).toList
      ++ "\n" ++ indent ++ "]"
  | .obj fields =>
    if fields.isEmpty then "{}"
    else "{\n" ++ ",\n".intercalate (fields.map fun (k, f) =>
        inner ++ quote k ++ ": " ++ f.pretty inner).toList
      ++ "\n" ++ indent ++ "}"
  | v => v.compact

end Thales
