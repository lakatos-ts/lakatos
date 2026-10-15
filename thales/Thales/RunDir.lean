/-! Where a run's artifacts go, and the source-tree mirroring under it. -/

namespace Thales

open System (FilePath)

/-- The root every run's artifacts land under, one directory per invocation. -/
def runRoot : String := ".lakatos"

/-- The gate's incremental cache, under the run root but not of any one run. -/
def typecheckCache : String := "typecheck.tsbuildinfo"

/-- A run root that cannot be used; `Main` reports it as an input error
(`error:` and exit 2). -/
def RunDirError (message : String) : IO.Error := IO.userError message

/-- Named by the instant the envelope reports as `startedAt`, with colons
as hyphens (illegal in Windows paths); the rest of the ISO string keeps
runs sortable. -/
def runDirFor (startedAt : String) : FilePath :=
  FilePath.mk runRoot / (startedAt.replace ":" "-")

/-- How many names to try before concluding something is wrong with the run
root rather than with this one name. -/
def maxClaimAttempts : Nat := 100

/-- The `n`th name tried for a run: the bare name, then `-2`, `-3`, ... -/
def claimName (startedAt : String) (n : Nat) : FilePath :=
  let first := runDirFor startedAt
  if n == 1 then first else FilePath.mk s!"{first}-{n}"

/-- This invocation's run directory, created here so the name is reserved
rather than merely observed free. An occupied name (two runs in one
millisecond) is stepped over. The path is cwd-relative (`.lakatos/<t>`),
as reported to the user; `base` prefixes it, for tests. -/
def claimRunDir (startedAt : String) (base : Option FilePath := none) : IO FilePath := do
  let under (p : FilePath) : FilePath := match base with | some b => b / p | none => p
  IO.FS.createDirAll (under (FilePath.mk runRoot))
  for n in [1:maxClaimAttempts + 1] do
    let dir := under (claimName startedAt n)
    try
      -- Non-recursive on purpose: the existence failure is what makes the
      -- claim atomic.
      IO.FS.createDir dir
      return dir
    catch
      | .alreadyExists .. => continue
      | e => throw e
  throw (RunDirError s!"{under (claimName startedAt 1)}: no free run directory after {maxClaimAttempts} attempts")

/-- The components of `p` with `.` dropped and `..` folded in, without
touching the file system. -/
private def resolve (p : FilePath) : List String :=
  let step (acc : List String) (c : String) : List String :=
    if c == "." || (c.isEmpty && !acc.isEmpty) then acc
    else if c == ".." then (match acc with | [] => [".."] | [""] => [""] | _ :: t => if acc.head? == some ".." then c :: acc else t)
    else c :: acc
  (p.components.foldl step []).reverse

/-- `file`'s cwd-relative path under `outRoot` with `suffix` appended to
the full name, so files differing only by extension cannot collide. A path
leading outside the cwd is refused rather than scattered. -/
def mirrorPath (cwd : FilePath) (file : String) (outRoot : FilePath) (suffix : String) :
    Except String FilePath :=
  let f := FilePath.mk file
  let abs := resolve (if f.isAbsolute then f else cwd / f)
  let base := resolve cwd
  if abs.length < base.length || abs.take base.length != base || abs.any (· == "..") then
    .error s!"{file} is outside the current directory; run lakatos from the directory containing it"
  else
    .ok (outRoot / (String.intercalate "/" (abs.drop base.length) ++ suffix))

end Thales
