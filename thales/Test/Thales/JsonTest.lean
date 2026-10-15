import Thales.Json

open Lean Thales

/-! `Out` prints as `JSON.stringify` does: the envelope's bytes are pinned
against the TypeScript tool's until that tool is gone. -/

-- Strings: the quote, the backslash, and the C0 controls escaped, the
-- five with short forms by them; DEL, U+2028, and non-ASCII as themselves.
#guard quote "plain" = "\"plain\""
#guard quote "a\"b\\c" = "\"a\\\"b\\\\c\""
#guard quote "\x08\x0c\n\r\t" = "\"\\b\\f\\n\\r\\t\""
#guard quote "\x00\x1f" = "\"\\u0000\\u001f\""
#guard quote "\x7f é→" = "\"\x7f é→\""

-- Numbers: integral values print bare, however the wire spelled them.
#guard number 0 = "0"
#guard number (JsonNumber.fromInt (-5)) = "-5"
#guard number ⟨10, 1⟩ = "1"
#guard number ⟨15, 1⟩ = "1.5"

-- Fields keep the order they were written in, not sorted.
#guard (Out.obj #[("b", .int 1), ("a", .bool true)]).compact = "{\"b\":1,\"a\":true}"

-- `Lean.Json` converts in its own (sorted) order.
#guard Out.ofJson (Json.mkObj [("y", 1), ("x", "s")]) == .obj #[("x", .str "s"), ("y", .int 1)]

-- `JSON.stringify(v, null, 2)`: two spaces a level, `": "` after a key,
-- and empty containers on one line.
#guard (Out.obj #[("a", .arr #[]), ("b", .obj #[]), ("c", .null)]).pretty
  = "{\n  \"a\": [],\n  \"b\": {},\n  \"c\": null\n}"
#guard (Out.obj #[("xs", .arr #[.int 1, .obj #[("k", "v")]])]).pretty
  = "{\n  \"xs\": [\n    1,\n    {\n      \"k\": \"v\"\n    }\n  ]\n}"
#guard (Out.arr #[]).pretty = "[]"
#guard (Out.str "x").pretty = "\"x\""
