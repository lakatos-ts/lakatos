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
`lemma/src/document.ts`. -/
def schemaVersion : Nat := 0

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

/-- Install the pinned release under `cache`, whole or not at all: npm
writes into a sibling directory, which is renamed into place only once
the installed version is the pinned one. -/
def install (cache : System.FilePath) : IO (Except String Unit) := do
  let parent := cache.parent.getD "."
  IO.FS.createDirAll parent
  let staging := parent / s!".lemma@{version}.{← IO.Process.getPID}"
  if ← staging.pathExists then IO.FS.removeDirAll staging
  let out ←
    try
      IO.Process.output
        { cmd := "npm"
          args := #["install", "--prefix", toString staging, "--no-audit",
                    "--no-fund", "--no-save", s!"@lakatos/lemma@{version}"] }
    catch e =>
      return .error s!"could not run npm to install @lakatos/lemma@{version}: {e}; {useOverride}"
  let cleanup := do if ← staging.pathExists then IO.FS.removeDirAll staging
  if out.exitCode != 0 then
    cleanup
    return .error s!"npm could not install @lakatos/lemma@{version} into {cache}:\n{out.stderr.trimAsciiEnd}\n{useOverride}"
  let got ← packageVersion (installedPackage staging)
  unless got == some version do
    cleanup
    return .error s!"npm installed @lakatos/lemma {got.getD "(no version)"}, not the pinned {version}; {useOverride}"
  -- Another run may have finished the same install first; its copy is
  -- as good as this one.
  if ← cache.pathExists then
    cleanup
    return .ok ()
  IO.FS.rename staging cache
  return .ok ()

/-- lemma's bin, from the override or the cache, installing the pinned
release first if it is not there. -/
def resolve : IO (Except String System.FilePath) := do
  if let some dir ← IO.getEnv "LAKATOS_LEMMA" then
    let bin := binIn dir
    if ← bin.pathExists then return .ok bin
    return .error s!"LAKATOS_LEMMA={dir} has no {bin}: build lemma first (npm run build from the repo root)"
  let some home ← IO.getEnv "HOME"
    | return .error s!"HOME is not set, so there is no cache to install lemma into; {useOverride}"
  let cache := cacheDir home
  let pkg := installedPackage cache
  if (← (binIn pkg).pathExists) && (← packageVersion pkg) == some version then
    return .ok (binIn pkg)
  if ← cache.pathExists then IO.FS.removeDirAll cache
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

/-- One checked-program document. The program stays JSON: the caller
decodes it with `Tarski.decodeProgram`, or reads another field, as the
engine it serves needs. -/
inductive Document where
  | program (file : String) (gated : Bool) (json : Json)
  | refused (file : String) (gated : Bool) (reason : String)
      (message : String) (diagnostics : Array Diagnostic)
deriving Inhabited

def Document.file : Document → String
  | .program f .. | .refused f .. => f

private def decodeDiagnostic (j : Json) : Except String Diagnostic := do
  pure { file := (j.getObjValAs? String "file").toOption
         line := (j.getObjValAs? Nat "line").toOption
         code := ← j.getObjValAs? Nat "code"
         message := ← j.getObjValAs? String "message" }

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
  | "program" => pure (.program file gated (← j.getObjVal? "program"))
  | "refused" =>
    let diagnostics ← match j.getObjVal? "diagnostics" with
      | .ok (.arr ds) => ds.mapM decodeDiagnostic
      | .ok _ => throw "the lemma document's diagnostics are not an array"
      | .error _ => pure #[]
    pure (.refused file gated (← j.getObjValAs? String "reason")
      (← j.getObjValAs? String "message") diagnostics)
  | other => throw s!"unknown lemma document outcome '{other}'"

/-- Decode `lemma … --jsonl` output: one document per non-empty line. -/
def decodeLines (out : String) : Except String (Array Document) :=
  (out.splitOn "\n").toArray.filter (!·.all Char.isWhitespace)
    |>.mapM fun line => Json.parse line >>= decodeDocument

/-- Run lemma's bin with `args` (a subcommand and its files; `--jsonl` is
added) and decode a document per file. lemma answers 0 or 1 with a
document per file either way; anything else is a failure to run it at
all, and its stderr is the reason. -/
def run (bin : System.FilePath) (args : Array String) :
    IO (Except String (Array Document)) := do
  let out ←
    try
      IO.Process.output { cmd := "node", args := #[toString bin, "--jsonl"] ++ args }
    catch e =>
      return .error s!"could not run node on lemma ({bin}): {e}"
  unless out.exitCode == 0 || out.exitCode == 1 do
    return .error s!"lemma exited {out.exitCode}:\n{out.stderr.trimAsciiEnd}"
  match decodeLines out.stdout with
  | .ok docs => return .ok docs
  | .error msg => return .error s!"lemma printed a document this executable cannot read: {msg}"

/-- `lemma check` on `files`, under the shared gate cache `tsbuildinfo`. -/
def check (bin : System.FilePath) (files : Array String)
    (tsbuildinfo : String := ".lakatos/typecheck.tsbuildinfo") :
    IO (Except String (Array Document)) :=
  run bin (#["check", "--tsbuildinfo", tsbuildinfo] ++ files)

/-- `lemma parse` on `files`: no gate, nothing stripped. -/
def parse (bin : System.FilePath) (files : Array String) :
    IO (Except String (Array Document)) :=
  run bin (#["parse"] ++ files)

end Tarski.Lemma
