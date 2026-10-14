import Tarski.Lemma

/-! lemma's documents decode strictly, version first; the resolver's paths
are where the design record puts them. Running lemma itself is
`frontend/tests/exe-e2e.test.ts`'s, which needs Node. -/

open Lean Tarski.Lemma

#guard version == "0.2.0"
#guard schemaVersion == 0
#guard cacheDir "/home/u" == ("/home/u/.cache/lakatos/lemma@0.2.0" : System.FilePath)
#guard binIn (installedPackage (cacheDir "/h")) ==
  ("/h/.cache/lakatos/lemma@0.2.0/node_modules/@lakatos/lemma/dist/cli.js" : System.FilePath)

def programDoc : String :=
  "{\"schemaVersion\":0,\"file\":\"a.ts\",\"gated\":true,\"outcome\":\"program\",\"program\":{\"type\":\"Program\",\"body\":[]}}"

def refusedDoc : String :=
  "{\"schemaVersion\":0,\"file\":\"b.ts\",\"gated\":true,\"outcome\":\"refused\",\"reason\":\"typecheck\",\"message\":\"m\",\"diagnostics\":[{\"file\":\"b.ts\",\"line\":1,\"code\":2322,\"message\":\"no\"},{\"code\":5023,\"message\":\"opt\"}]}"

#guard match Json.parse programDoc >>= decodeDocument with
  | .ok (.program "a.ts" true _) => true
  | _ => false

#guard match Json.parse refusedDoc >>= decodeDocument with
  | .ok (.refused "b.ts" true "typecheck" "m" ds) =>
    ds.map (·.format) == #["b.ts:1: TS2322: no", "TS5023: opt"]
  | _ => false

-- Another version fails by name, before anything else is read.
#guard match Json.parse "{\"schemaVersion\":1}" >>= decodeDocument with
  | .error "lemma document version 1, but this executable reads version 0" => true
  | _ => false
#guard (Json.parse "{\"file\":\"a.ts\"}" >>= decodeDocument) matches .error _
#guard match Json.parse "{\"schemaVersion\":0,\"file\":\"a\",\"gated\":false,\"outcome\":\"maybe\"}" >>= decodeDocument with
  | .error "unknown lemma document outcome 'maybe'" => true
  | _ => false

-- `--jsonl`: a document a line, blank lines aside, in order.
#guard match decodeLines s!"{programDoc}\n{refusedDoc}\n\n" with
  | .ok docs => docs.map (·.file) == #["a.ts", "b.ts"]
  | .error _ => false
#guard (decodeLines "{\"schemaVersion\":0}\n") matches .error _
