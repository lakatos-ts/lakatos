/-! Where the runner's pieces are, given where the executable is. -/

namespace Tarski.Test262

open System (FilePath)

/-- The `tarski/` lake package: the nearest ancestor of `start` that either
holds a `tarski/lakefile.lean` or is one itself. -/
partial def findTarskiRoot (start : FilePath) : IO (Option FilePath) := do
  let rec up (dir : FilePath) : IO (Option FilePath) := do
    for candidate in [dir, dir / "tarski"] do
      if ← (candidate / "lakefile.lean").pathExists then return some candidate
    match dir.parent with
    | some parent => if parent == dir then return none else up parent
    | none => return none
  match start.parent with
  | some dir => up dir
  | none => return none

/-- Where `lake build tarski` puts the binary. -/
def defaultBinary (root : FilePath) : FilePath := root / ".lake" / "build" / "bin" / "tarski"

/-- The checkout: `LAKATOS_TEST262` (`env`) when it is set, the ignored
clone `setup` makes otherwise. -/
def defaultCheckout (root : FilePath) (env : Option String) : FilePath :=
  match env with
  | some dir => dir
  | none => root / ".test262"

/-- The pinned commit `setup` fetches. -/
def pinPath (root : FilePath) : FilePath := root / "test262" / "pin.json"

/-- A fresh directory under `TMPDIR` (or `/tmp`), named by `stem`, the pid,
and the clock. -/
def scratchDir (stem : String) : IO FilePath := do
  let base := match ← IO.getEnv "TMPDIR" with
    | some t => if t.isEmpty then "/tmp" else t
    | none => "/tmp"
  let dir : FilePath := base / s!"{stem}-{← IO.Process.getPID}-{← IO.monoNanosNow}"
  IO.FS.createDirAll dir
  return dir

end Tarski.Test262
