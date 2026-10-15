import Thales.RunDir

open Thales

-- Rooted at .lakatos, named by the start instant, with no colons.
#guard runDirFor "2026-10-15T07:02:47.147Z" = ".lakatos" / "2026-10-15T07-02-47.147Z"
#guard !(runDirFor "2026-10-15T07:02:47.147Z").toString.contains ':'
-- Two runs a millisecond apart get separate directories.
#guard runDirFor "2026-10-15T07:02:47.147Z" != runDirFor "2026-10-15T07:02:47.148Z"
#guard typecheckCache = ".lakatos" / "typecheck.tsbuildinfo"

/-- Run `act` from a fresh scratch directory, back where it started after. -/
def inScratch {α : Type} (act : IO α) : IO α := do
  let here ← IO.currentDir
  let dir := (← IO.FS.createTempDir)
  IO.Process.setCurrentDir dir
  try act finally
    IO.Process.setCurrentDir here
    IO.FS.removeDirAll dir

def expect (ok : Bool) (what : String) : IO Unit :=
  unless ok do throw (IO.userError s!"expected {what}")

-- Claims step over a taken name, and give up once every name is taken.
#eval inScratch do
  let t := "2026-10-15T07:02:47.147Z"
  let .ok first ← claimRunDir t | throw (IO.userError "first claim failed")
  expect (first == runDirFor t) "the first claim to get the base name"
  let .ok second ← claimRunDir t | throw (IO.userError "second claim failed")
  expect (second.toString == s!"{runDirFor t}-2") "the second claim to step over it"
  for _ in [2:maxClaimAttempts] do
    let .ok _ ← claimRunDir t | throw (IO.userError "a claim failed early")
  match ← claimRunDir t with
  | .ok d => throw (IO.userError s!"expected exhaustion, got {d}")
  | .error msg => expect (msg.endsWith s!"no free run directory after {maxClaimAttempts} attempts") msg

-- A failure that is not a collision comes back as itself.
#eval inScratch do
  IO.FS.writeFile ".lakatos" "a file where the run root should be"
  match ← claimRunDir "t" with
  | .ok d => throw (IO.userError s!"expected a failure, got {d}")
  | .error msg => expect (msg.startsWith ".lakatos") msg
