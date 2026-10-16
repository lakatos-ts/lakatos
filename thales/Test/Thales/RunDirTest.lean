import Thales.RunDir

open Thales

#guard runDirFor "2026-10-15T05:51:03.286Z" == (".lakatos/2026-10-15T05-51-03.286Z" : System.FilePath)

private def mirrors (cwd file out suffix : String) : Option System.FilePath :=
  (mirrorPath cwd file out suffix).toOption

#guard mirrors "/w" "src/a.ts" "/w/.lakatos/r/thales" ".json" == some "/w/.lakatos/r/thales/src/a.ts.json"
#guard mirrors "/w" "./src/a.ts" "/w/.lakatos/r/thales" ".lean" == some "/w/.lakatos/r/thales/src/a.ts.lean"
#guard mirrors "/w" "/w/src/../src/a.ts" "/w/out" ".json" == some "/w/out/src/a.ts.json"
#guard mirrors "/w" "src/../../w/a.ts" "/w/out" ".json" == some "/w/out/a.ts.json"

-- A file outside the cwd is refused, not mirrored above the root.
#guard match mirrorPath "/w" "../x.ts" "/w/out" ".json" with
  | .error m => m == "../x.ts is outside the current directory; run lakatos from the directory containing it"
  | .ok _ => false
#guard (mirrors "/w" "/elsewhere/x.ts" "/w/out" ".json").isNone
#guard (mirrors "/w" "/wx/a.ts" "/w/out" ".json").isNone
#guard (mirrors "/w" "a/../../x.ts" "/w/out" ".json").isNone

-- The reported spelling is cwd-relative.
#guard claimName "2026-01-01T00:00:00.000Z" 1 == (".lakatos/2026-01-01T00-00-00.000Z" : System.FilePath)
#guard claimName "2026-01-01T00:00:00.000Z" 2 == (".lakatos/2026-01-01T00-00-00.000Z-2" : System.FilePath)

-- The same instant twice claims two directories.
#eval show IO Unit from do
  let tmp ← IO.FS.createTempDir
  let t := "2026-01-01T00:00:00.000Z"
  let d1 ← claimRunDir t (some tmp)
  let d2 ← claimRunDir t (some tmp)
  unless d1 == tmp / ".lakatos" / "2026-01-01T00-00-00.000Z" do throw (IO.userError s!"d1 = {d1}")
  unless d2 == tmp / ".lakatos" / "2026-01-01T00-00-00.000Z-2" do throw (IO.userError s!"d2 = {d2}")
  unless ← d2.isDir do throw (IO.userError "d2 not created")
  IO.FS.removeDirAll tmp

-- A run root with every name taken is an error, not an endless loop.
#eval show IO Unit from do
  let tmp ← IO.FS.createTempDir
  let t := "2026-01-01T00:00:00.000Z"
  for _ in [0:maxClaimAttempts] do
    discard <| claimRunDir t (some tmp)
  try
    discard <| claimRunDir t (some tmp)
    throw (IO.userError "expected exhaustion")
  catch e =>
    let want := s!"{tmp / ".lakatos" / "2026-01-01T00-00-00.000Z"}: no free run directory after 100 attempts"
    unless toString e == want do throw (IO.userError s!"got {e}")
  IO.FS.removeDirAll tmp
