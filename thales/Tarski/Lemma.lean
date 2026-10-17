import Lean.Data.Json

/-! Reaching lemma: the TypeScript front end, run as a subprocess.

`tsc` is the type-checking oracle and lemma is how a Lean executable asks
it: `lemma check` type checks the project, strips a file's types, and
prints the checked-program document (`lemma/schemas/lemma-document.schema.json`)
for it, refused or not. This module finds lemma's bin, runs it, and decodes
what it prints. It is shared by every executable that reads TypeScript —
`tarski`, `thales`, the test262 runner — so nothing here is about running
a program.

Which lemma runs:

* `LAKATOS_LEMMA=<dir>` names a lemma checkout (the `lemma/` package
  directory, built), for developing against an unreleased lemma. Its
  package version is not checked; the document's `schemaVersion` still is.
* Otherwise the pinned release, `@lakatos/lemma@` `version`, installed on
  first use into `~/.cache/lakatos/lemma@<version>` with `npm` and run
  with `node` directly from there afterwards, so a run never pays for
  `npx`. The installed package's own version is checked against the pin. -/

namespace Tarski.Lemma

open Lean

/-- The lemma release these executables are written against. -/
def version : String := "0.2.0"

/-- The document version these executables read: `SCHEMA_VERSION` in
`lemma/src/document.ts`. 1 carries each annotation's outcome. -/
def schemaVersion : Nat := 1

/-- Where the pinned release is installed, under `home`. -/
def cacheDir (home : System.FilePath) : System.FilePath :=
  home / ".cache" / "lakatos" / s!"lemma@{version}"

/-- The bin inside a lemma package directory. -/
def binIn (pkg : System.FilePath) : System.FilePath :=
  pkg / "dist" / "cli.js"

/-- The package directory `npm install --prefix` leaves under `prefix`. -/
def installedPackage (prefix_ : System.FilePath) : System.FilePath :=
  prefix_ / "node_modules" / "@lakatos" / "lemma"

/-- A package directory's `version`, if its `package.json` has one. -/
def packageVersion (pkg : System.FilePath) : IO (Option String) := do
  let path := pkg / "package.json"
  unless ← path.pathExists do return none
  match Json.parse (← IO.FS.readFile path) with
  | .ok j => pure (j.getObjValAs? String "version").toOption
  | .error _ => pure none

/-- What to do when lemma cannot be had: point at the override. -/
private def useOverride : String :=
  "set LAKATOS_LEMMA to a built lemma checkout to use one instead"

/-- An environment variable, with an empty value read as unset: Lean's
`"" / x` is the absolute `/x`, which is never what an empty `HOME` or
`LAKATOS_LEMMA` meant. -/
def envVar (name : String) : IO (Option String) := do
  match ← IO.getEnv name with
  | some "" => pure none
  | v => pure v

/-- Whether a package directory holds the pinned release, bin and all. -/
def isPinned (pkg : System.FilePath) : IO Bool := do
  return (← (binIn pkg).pathExists) && (← packageVersion pkg) == some version

/-- Install the pinned release under `cache`, whole or not at all: npm
writes into a sibling staging directory, which is renamed into place only
once the installed version is the pinned one, and removed whatever
happens. Runs racing on a cold cache each install; the first rename wins
and the others use its copy. Any IO failure is an answer, never an
exception. -/
def install (cache : System.FilePath) : IO (Except String Unit) := do
  let parent := cache.parent.getD "."
  let staging := parent / s!".lemma@{version}.{← IO.Process.getPID}"
  let cleanup : IO Unit :=
    try if ← staging.pathExists then IO.FS.removeDirAll staging
    catch _ => pure ()
  try
    IO.FS.createDirAll parent
    cleanup
    let out ← IO.Process.output
      { cmd := "npm"
        args := #["install", "--prefix", toString staging, "--no-audit",
                  "--no-fund", "--no-save", s!"@lakatos/lemma@{version}"] }
    if out.exitCode != 0 then
      return .error s!"npm could not install @lakatos/lemma@{version} into {cache}:\n{out.stderr.trimAsciiEnd}\n{useOverride}"
    let got ← packageVersion (installedPackage staging)
    unless got == some version do
      return .error s!"npm installed @lakatos/lemma {got.getD "(no version)"}, not the pinned {version}; {useOverride}"
    try IO.FS.rename staging cache
    catch e =>
      -- Another run moved its own install into place first; its copy is
      -- as good as this one.
      unless ← isPinned (installedPackage cache) do
        return .error s!"could not move the lemma install into {cache}: {e}; {useOverride}"
    return .ok ()
  catch e =>
    return .error s!"could not install @lakatos/lemma@{version} into {cache}: {e}; {useOverride}"
  finally cleanup

/-- lemma's bin, from the override or the cache, installing the pinned
release first if it is not there. Any IO failure is an answer, never an
exception. -/
def resolve : IO (Except String System.FilePath) := do
  if let some dir ← envVar "LAKATOS_LEMMA" then
    let bin := binIn dir
    if ← bin.pathExists then return .ok bin
    return .error s!"LAKATOS_LEMMA={dir} has no {bin}: build lemma first (npm run build from the repo root)"
  let some home ← envVar "HOME"
    | return .error s!"HOME is not set, so there is no cache to install lemma into; {useOverride}"
  let cache := cacheDir home
  let pkg := installedPackage cache
  if ← isPinned pkg then return .ok (binIn pkg)
  try
    if ← cache.pathExists then IO.FS.removeDirAll cache
  catch e =>
    -- Another run may be replacing the same stale copy.
    unless ← isPinned pkg do
      return .error s!"could not clear the stale lemma at {cache}: {e}; {useOverride}"
    return .ok (binIn pkg)
  match ← install cache with
  | .error msg => return .error msg
  | .ok () => return .ok (binIn pkg)

/-- One finding of the gate, as the document carries it. -/
structure Diagnostic where
  file : Option String
  line : Option Nat
  code : Nat
  message : String
deriving Repr, DecidableEq, Inhabited

/-- `file:line: TS<code>: <message>`, as `tsc` and lemma's `admit` print
it; a project-level finding has no site. -/
def Diagnostic.format (d : Diagnostic) : String :=
  let site := match d.file, d.line with
    | some f, some l => s!"{f}:{l}: "
    | some f, none => s!"{f}: "
    | none, _ => ""
  s!"{site}TS{d.code}: {d.message}"

/-- What became of one `@ensures`, as the document says. -/
inductive Outcome where
  /-- The emission carries exactly one `#thales_prove` for it. -/
  | tried
  /-- The emitter settled it before Lean. -/
  | classified (szs : String) (kind : Option String) (reason : String)
  /-- An input error; `cause` is `extraction`, `typing`, or `gate`. -/
  | refused (cause : String) (error : String)
deriving Repr, BEq, Inhabited

structure Annotation where
  function : String
  property : String
  line : Nat
  outcome : Outcome
deriving Repr, BEq, Inhabited

/-- One checked-program document. `json` is the whole document: the caller
reads `program` (and decodes it with `Tarski.decodeProgram`) or `emission`
from it, as the engine it serves needs. -/
inductive Document where
  | program (file : String) (gated : Bool) (json : Json)
      (annotations : Array Annotation)
  | refused (file : String) (gated : Bool) (reason : String)
      (message : String) (diagnostics : Array Diagnostic) (json : Json)
      (annotations : Array Annotation)
deriving Inhabited

def Document.file : Document → String
  | .program f .. | .refused f .. => f

def Document.annotations : Document → Array Annotation
  | .program _ _ _ as => as
  | .refused _ _ _ _ _ _ as => as

def Document.json : Document → Json
  | .program _ _ j _ => j
  | .refused _ _ _ _ _ j _ => j

private def decodeDiagnostic (j : Json) : Except String Diagnostic := do
  pure { file := (j.getObjValAs? String "file").toOption
         line := (j.getObjValAs? Nat "line").toOption
         code := ← j.getObjValAs? Nat "code"
         message := ← j.getObjValAs? String "message" }

private def decodeOutcome (j : Json) : Except String Outcome := do
  match ← j.getObjValAs? String "outcome" with
  | "tried" => pure .tried
  | "classified" =>
    let szs ← j.getObjValAs? String "szs"
    unless szs == "Inappropriate" || szs == "Error" || szs == "NotTried" do
      throw s!"unknown classified szs '{szs}'"
    let kind ← match j.getObjVal? "kind" with
      | .error _ => pure none
      | .ok k => match k.getStr? with
        | .ok "unsupported-range" => pure (some "unsupported-range")
        | .ok k => throw s!"unknown classified kind '{k}'"
        | .error _ => throw "the classified kind is not a string"
    pure (.classified szs kind (← j.getObjValAs? String "reason"))
  | "refused" =>
    let cause ← j.getObjValAs? String "cause"
    unless cause == "extraction" || cause == "typing" || cause == "gate" do
      throw s!"unknown refusal cause '{cause}'"
    pure (.refused cause (← j.getObjValAs? String "error"))
  | other => throw s!"unknown annotation outcome '{other}'"

private def decodeAnnotation (j : Json) : Except String Annotation := do
  pure { function := ← j.getObjValAs? String "function"
         property := ← j.getObjValAs? String "property"
         line := ← j.getObjValAs? Nat "line"
         outcome := ← decodeOutcome j }

/-- A `parse` document has no `annotations`, which reads as none. -/
private def decodeAnnotations (j : Json) : Except String (Array Annotation) :=
  match j.getObjVal? "annotations" with
  | .ok (.arr as) => as.mapM decodeAnnotation
  | .ok _ => throw "the lemma document's annotations are not an array"
  | .error _ => pure #[]

/-- Decode one document. A document of another `schemaVersion` fails by
name before anything else is read. -/
def decodeDocument (j : Json) : Except String Document := do
  match j.getObjValAs? Nat "schemaVersion" with
  | .ok v =>
    unless v == schemaVersion do
      throw s!"lemma document version {v}, but this executable reads version {schemaVersion}"
  | .error _ => throw "the lemma document's schemaVersion is not a version number"
  let file ← j.getObjValAs? String "file"
  let gated ← j.getObjValAs? Bool "gated"
  match ← j.getObjValAs? String "outcome" with
  | "program" => pure (.program file gated j (← decodeAnnotations j))
  | "refused" =>
    let diagnostics ← match j.getObjVal? "diagnostics" with
      | .ok (.arr ds) => ds.mapM decodeDiagnostic
      | .ok _ => throw "the lemma document's diagnostics are not an array"
      | .error _ => pure #[]
    pure (.refused file gated (← j.getObjValAs? String "reason")
      (← j.getObjValAs? String "message") diagnostics j (← decodeAnnotations j))
  | other => throw s!"unknown lemma document outcome '{other}'"

/-- Decode `lemma … --jsonl` output: one document per non-empty line. -/
def decodeLines (out : String) : Except String (Array Document) :=
  (out.splitOn "\n").toArray.filter (!·.all Char.isWhitespace)
    |>.mapM fun line => Json.parse line >>= decodeDocument

/-- Run lemma's bin on `files` (`--jsonl` is added after the subcommand's
`args`) and decode a document per file, in order. lemma answers 0 when
every file has a program and 1 when one was refused, with a document per
file either way. Anything else — another status, a document missing or
out of order, or a 1 with nothing refused, which is Node's status for a
crash — is a failure to run lemma at all, and its stderr is the reason. -/
def run (bin : System.FilePath) (args files : Array String) :
    IO (Except String (Array Document)) := do
  let out ←
    try
      IO.Process.output
        { cmd := "node", args := #[toString bin, "--jsonl"] ++ args ++ files }
    catch e =>
      return .error s!"could not run node on lemma ({bin}): {e}"
  let failed (why : String) : Except String (Array Document) :=
    .error s!"lemma {why}:\n{out.stderr.trimAsciiEnd}"
  unless out.exitCode == 0 || out.exitCode == 1 do
    return failed s!"exited {out.exitCode}"
  match decodeLines out.stdout with
  | .error msg => return .error s!"lemma printed a document this executable cannot read: {msg}"
  | .ok docs =>
    unless docs.map (·.file) == files do
      return failed s!"answered for {docs.map (·.file)}, not for {files}"
    let refused := docs.any fun | .refused .. => true | .program .. => false
    if out.exitCode == 1 && !refused then
      return failed "exited 1 with every file answered, which is a crash"
    return .ok docs

/-- `lemma check` on `files`, under the shared gate cache `tsbuildinfo`. -/
def check (bin : System.FilePath) (files : Array String)
    (tsbuildinfo : String := ".lakatos/typecheck.tsbuildinfo") :
    IO (Except String (Array Document)) :=
  run bin #["check", "--tsbuildinfo", tsbuildinfo] files

/-- `lemma check` over patterns, discovery when there are none: lemma
decides which files answer, so the only check is that each answered file
is a document. -/
def checkPatterns (bin : System.FilePath) (patterns : Array String)
    (tsbuildinfo : String := ".lakatos/typecheck.tsbuildinfo") :
    IO (Except String (Array Document)) := do
  let out ←
    try
      IO.Process.output
        { cmd := "node"
          args := #[toString bin, "check", "--jsonl", "--tsbuildinfo", tsbuildinfo] ++ patterns }
    catch e =>
      return .error s!"could not run node on lemma ({bin}): {e}"
  -- Exit 2 is lemma refusing the command line: a pattern matching nothing,
  -- a broken tsconfig. Its message is the whole answer.
  if out.exitCode == 2 then return .error (toString out.stderr.trimAsciiEnd)
  unless out.exitCode == 0 || out.exitCode == 1 do
    return .error s!"lemma exited {out.exitCode}:\n{out.stderr.trimAsciiEnd}"
  match decodeLines out.stdout with
  | .error msg => return .error s!"lemma printed a document this executable cannot read: {msg}"
  | .ok docs =>
    let refused := docs.any fun | .refused .. => true | .program .. => false
    if out.exitCode == 1 && !refused then
      return .error s!"lemma exited 1 with every file answered, which is a crash:\n{out.stderr.trimAsciiEnd}"
    return .ok docs

/-- `lemma parse` on `files`: no gate, nothing stripped. -/
def parse (bin : System.FilePath) (files : Array String) :
    IO (Except String (Array Document)) :=
  run bin #["parse"] files

end Tarski.Lemma
