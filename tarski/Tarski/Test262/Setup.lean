import Lean.Data.Json

/-! Provisioning test262 at a pinned commit.

Never a submodule: that would put the suite's history in every clone. This
does what `actions/checkout` does — `git init`, a remote, a depth-1 fetch
of one SHA — into a gitignored directory, a build artifact like `.lake/`. -/

namespace Tarski.Test262

open Lean
open System (FilePath)

/-- The commit the suite is read at, and where to get it. -/
structure Pin where
  repository : String
  commit : String
deriving Repr, BEq

def readPin (file : FilePath) : IO Pin := do
  let j ← IO.ofExcept (Json.parse (← IO.FS.readFile file))
  IO.ofExcept do
    return { repository := ← j.getObjValAs? String "repository", commit := ← j.getObjValAs? String "commit" }

/-- `git args` in `cwd`; a nonzero status is an error carrying stderr. -/
def git (args : Array String) (cwd : Option FilePath := none) : IO String := do
  let out ← IO.Process.output { cmd := "git", args, cwd }
  if out.exitCode != 0 then
    throw (IO.userError s!"git {" ".intercalate args.toList}: {out.stderr.trimAsciiEnd}")
  return out.stdout

/-- The commit checked out in `dir`, none when there is no repository or no HEAD. -/
def headOf (dir : FilePath) : IO (Option String) := do
  unless ← (dir / ".git").pathExists do return none
  try
    return some (toString (← git #["-C", toString dir, "rev-parse", "HEAD"]).trimAscii)
  catch _ =>
    -- An interrupted fetch leaves a repository with no HEAD; re-fetching
    -- is the cheapest way back.
    return none

/-- Put `dir` at the pin, fetching it unless it is there already: safe to
run before every slice and cheap in a cached CI job. -/
def setupTest262 (dir : FilePath) (pin : Pin) (say : String → IO Unit) : IO Unit := do
  if (← headOf dir) == some pin.commit then
    say s!"test262 already at {pin.commit}"
    return
  IO.FS.createDirAll dir
  unless ← (dir / ".git").pathExists do
    let _ ← git #["init", "--quiet"] dir
  try
    let _ ← git #["remote", "add", "origin", pin.repository] dir
  catch _ =>
    -- Already there, pointing somewhere that may no longer be the pin's.
    let _ ← git #["remote", "set-url", "origin", pin.repository] dir
  say s!"fetching {pin.commit} from {pin.repository}"
  let _ ← git #["fetch", "--depth", "1", "origin", pin.commit] dir
  let _ ← git #["checkout", "--quiet", "FETCH_HEAD"] dir
  say s!"test262 at {pin.commit} in {dir}"

end Tarski.Test262
