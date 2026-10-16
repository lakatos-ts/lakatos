import Tarski.Test262.Paths

open Tarski.Test262
open System (FilePath)

/-! Run from `tarski/`. -/

-- These tests read the package's files by relative path.
#eval show IO Unit from do
  unless ← ("lakefile.lean" : System.FilePath).pathExists do
    throw (IO.userError "run from tarski/, as lake build TarskiTest does")

def expect (what : String) (ok : Bool) : IO Unit :=
  unless ok do throw (IO.userError s!"failed: {what}")

-- finds the lake package from a file inside it
#eval show IO Unit from do
  let here := (← IO.currentDir) / "Test" / "Tarski" / "Test262" / "PathsTest.lean"
  let some root ← findTarskiRoot here | throw (IO.userError "no root")
  expect "a lakefile" (← (root / "lakefile.lean").pathExists)
  expect "the package" (root == (← IO.currentDir))

-- finds the package as a child of an ancestor, from a sibling tree
#eval show IO Unit from do
  let repo := (← IO.currentDir).parent.get!
  expect "sibling" ((← findTarskiRoot (repo / "lemma" / "dist" / "cli.js")) == some (repo / "tarski"))

-- stops at the package root from the built executable
#eval show IO Unit from do
  let root ← IO.currentDir
  expect "the built runner" ((← findTarskiRoot (root / ".lake" / "build" / "bin" / "tarski-test262")) == some root)

-- none where there is no lake package
#eval show IO Unit from do
  expect "nothing" ((← findTarskiRoot "/nothing-here.js") == none)

#guard defaultBinary "/r" == ("/r" : FilePath) / ".lake" / "build" / "bin" / "tarski"
#guard defaultCheckout "/r" none == ("/r" : FilePath) / ".test262"
#guard defaultCheckout "/r" (some "/elsewhere") == ("/elsewhere" : FilePath)
#guard pinPath "/r" == ("/r" : FilePath) / "test262" / "pin.json"

#eval show IO Unit from do
  let a ← scratchDir "paths-test"
  let b ← scratchDir "paths-test"
  expect "fresh and distinct" (a != b && (← a.isDir) && (← b.isDir))
