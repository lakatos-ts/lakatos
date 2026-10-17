import Tarski.Test262.Setup
import Tarski.Test262.Paths

open Tarski.Test262
open System (FilePath)

/-! A scratch repository with two commits stands in for tc39/test262, so
the fetch-by-SHA path runs without the network. The pin names the older
commit, which shows the fetch is by SHA and not a clone of a branch tip.
Run from `thales/`. -/

-- These tests read the package's files by relative path.
#eval show IO Unit from do
  unless ← ("lakefile.lean" : System.FilePath).pathExists do
    throw (IO.userError "run from thales/, as lake build Test does")

def expect (what : String) (ok : Bool) : IO Unit :=
  unless ok do throw (IO.userError s!"failed: {what}")

def head (dir : FilePath) : IO String := do
  return toString (← git #["rev-parse", "HEAD"] dir).trimAscii

/-- An origin with commits `one` and `two` of README.md, the target path
(not yet created), and the two SHAs. -/
def origin : IO (FilePath × FilePath × String × String) := do
  let o ← scratchDir "test262-origin"
  let target := (← scratchDir "test262-target") / "checkout"
  let _ ← git #["init", "--quiet"] o
  let _ ← git #["config", "user.email", "test@example.com"] o
  let _ ← git #["config", "user.name", "Test"] o
  IO.FS.writeFile (o / "README.md") "one\n"
  let _ ← git #["add", "."] o
  let _ ← git #["commit", "--quiet", "-m", "one"] o
  let older ← head o
  IO.FS.writeFile (o / "README.md") "two\n"
  let _ ← git #["add", "."] o
  let _ ← git #["commit", "--quiet", "-m", "two"] o
  return (o, target, older, ← head o)

def setup (target o : FilePath) (commit : String) : IO (Array String) := do
  let log ← IO.mkRef #[]
  setupTest262 target { repository := toString o, commit } fun line => log.modify (·.push line)
  log.get

-- checks out the pinned commit into a fresh directory
#eval show IO Unit from do
  let (o, target, older, _) ← origin
  let log ← setup target o older
  expect "at the pin" ((← head target) == older)
  expect "the older text" ((← IO.FS.readFile (target / "README.md")) == "one\n")
  expect "logs the commit" (((log.back?.getD "").splitOn older).length == 2)

-- fetches at depth 1 and makes no submodule
#eval show IO Unit from do
  let (o, target, older, _) ← origin
  let _ ← setup target o older
  expect "depth 1" (toString (← git #["rev-list", "--count", "HEAD"] target).trimAscii == "1")
  expect "no submodule" !(← (target / ".gitmodules").pathExists)

-- is a no-op when the checkout is already at the pin
#eval show IO Unit from do
  let (o, target, older, _) ← origin
  let _ ← setup target o older
  expect "no-op" ((← setup target o older) == #[s!"test262 already at {older}"])

-- re-fetches into a repository that has no HEAD
#eval show IO Unit from do
  let (o, target, older, _) ← origin
  IO.FS.createDirAll target
  let _ ← git #["init", "--quiet"] target
  let _ ← setup target o older
  expect "fetched" ((← head target) == older)

-- moves a checkout at the wrong commit to the pin
#eval show IO Unit from do
  let (o, target, older, newer) ← origin
  let _ ← setup target o newer
  expect "newer" ((← head target) == newer)
  let _ ← setup target o older
  expect "older" ((← head target) == older)

-- re-points a remote that moved
#eval show IO Unit from do
  let (o, target, older, newer) ← origin
  let _ ← setup target o older
  let _ ← git #["remote", "set-url", "origin", "https://example.invalid/nope.git"] target
  let _ ← setup target o newer
  expect "re-pointed" ((← head target) == newer)

-- headOf: no repository, no answer
#eval show IO Unit from do
  expect "no repository" ((← headOf (← scratchDir "test262-empty")) == none)

-- the committed pin
#eval show IO Unit from do
  let pin ← readPin "test262/pin.json"
  expect "a 40-hex-digit commit" (pin.commit.length == 40 && pin.commit.all fun c => c.isDigit || ('a' ≤ c && c ≤ 'f'))
  expect "the upstream suite" (pin.repository == "https://github.com/tc39/test262.git")
