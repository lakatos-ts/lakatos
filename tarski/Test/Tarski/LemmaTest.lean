import Tarski.Lemma

/-! lemma's documents decode strictly, version first; the resolver's paths
are where the design record puts them. Running lemma itself is
`frontend/tests/exe-e2e.test.ts`'s, which needs Node. -/

open Lean Tarski.Lemma

#guard version == "0.2.0"
#guard schemaVersion == 1
#guard cacheDir "/home/u" == ("/home/u/.cache/lakatos/lemma@0.2.0" : System.FilePath)
#guard binIn (installedPackage (cacheDir "/h")) ==
  ("/h/.cache/lakatos/lemma@0.2.0/node_modules/@lakatos/lemma/dist/cli.js" : System.FilePath)

def programDoc : String :=
  "{\"schemaVersion\":1,\"file\":\"a.ts\",\"gated\":true,\"outcome\":\"program\",\"program\":{\"type\":\"Program\",\"body\":[]},\"annotations\":[{\"function\":\"f\",\"property\":\"p\",\"line\":3,\"outcome\":\"tried\"},{\"function\":\"g\",\"property\":\"q\",\"line\":9,\"outcome\":\"classified\",\"szs\":\"NotTried\",\"kind\":\"unsupported-range\",\"reason\":\"big\"},{\"function\":\"h\",\"property\":\"r\",\"line\":12,\"outcome\":\"refused\",\"cause\":\"typing\",\"error\":\"a.ts:12: no\"}]}"

def refusedDoc : String :=
  "{\"schemaVersion\":1,\"file\":\"b.ts\",\"gated\":true,\"outcome\":\"refused\",\"reason\":\"typecheck\",\"message\":\"m\",\"diagnostics\":[{\"file\":\"b.ts\",\"line\":1,\"code\":2322,\"message\":\"no\"},{\"code\":5023,\"message\":\"opt\"}],\"annotations\":[{\"function\":\"f\",\"property\":\"p\",\"line\":2,\"outcome\":\"refused\",\"cause\":\"gate\",\"error\":\"the program does not type check: b.ts:1: TS2322: no (and 1 more)\"}]}"

#guard match Json.parse programDoc >>= decodeDocument with
  | .ok d@(.program "a.ts" true _ _) =>
    d.annotations.map (·.function) == #["f", "g", "h"] &&
    d.annotations[1]!.outcome == .classified "NotTried" (some "unsupported-range") "big" &&
    d.annotations[2]!.outcome == .refused "typing" "a.ts:12: no"
  | _ => false

#guard match Json.parse refusedDoc >>= decodeDocument with
  | .ok d@(.refused "b.ts" true "typecheck" "m" ds _ _) =>
    ds.map (·.format) == #["b.ts:1: TS2322: no", "TS5023: opt"] &&
    d.annotations.size == 1 &&
    d.annotations[0]!.outcome == .refused "gate" "the program does not type check: b.ts:1: TS2322: no (and 1 more)"
  | _ => false

-- A `parse` document has no annotations field, which reads as none.
#guard match Json.parse "{\"schemaVersion\":1,\"file\":\"a.js\",\"gated\":false,\"outcome\":\"program\",\"program\":{}}" >>= decodeDocument with
  | .ok d => d.annotations.isEmpty
  | _ => false

-- An outcome's szs and cause are closed sets, not free strings.
#guard match Json.parse "{\"schemaVersion\":1,\"file\":\"a.ts\",\"gated\":true,\"outcome\":\"program\",\"program\":{},\"annotations\":[{\"function\":\"f\",\"property\":\"p\",\"line\":1,\"outcome\":\"classified\",\"szs\":\"Theorem\",\"reason\":\"r\"}]}" >>= decodeDocument with
  | .error "unknown classified szs 'Theorem'" => true
  | _ => false
#guard match Json.parse "{\"schemaVersion\":1,\"file\":\"a.ts\",\"gated\":true,\"outcome\":\"program\",\"program\":{},\"annotations\":[{\"function\":\"f\",\"property\":\"p\",\"line\":1,\"outcome\":\"refused\",\"cause\":\"whim\",\"error\":\"e\"}]}" >>= decodeDocument with
  | .error "unknown refusal cause 'whim'" => true
  | _ => false

#guard match Json.parse "{\"schemaVersion\":1,\"file\":\"a.ts\",\"gated\":true,\"outcome\":\"program\",\"program\":{},\"annotations\":[{\"function\":\"f\",\"property\":\"p\",\"line\":1,\"outcome\":\"classified\",\"szs\":\"NotTried\",\"kind\":\"other\",\"reason\":\"r\"}]}" >>= decodeDocument with
  | .error "unknown classified kind 'other'" => true
  | _ => false

-- Another version fails by name, before anything else is read.
#guard match Json.parse "{\"schemaVersion\":0}" >>= decodeDocument with
  | .error "lemma document version 0, but this executable reads version 1" => true
  | _ => false
#guard (Json.parse "{\"file\":\"a.ts\"}" >>= decodeDocument) matches .error _
#guard match Json.parse "{\"schemaVersion\":1,\"file\":\"a\",\"gated\":false,\"outcome\":\"maybe\"}" >>= decodeDocument with
  | .error "unknown lemma document outcome 'maybe'" => true
  | _ => false

-- `--jsonl`: a document a line, blank lines aside, in order.
#guard match decodeLines s!"{programDoc}\n{refusedDoc}\n\n" with
  | .ok docs => docs.map (·.file) == #["a.ts", "b.ts"]
  | .error _ => false
#guard (decodeLines "{\"schemaVersion\":1}\n") matches .error _
