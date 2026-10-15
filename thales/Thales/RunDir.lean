/-! Run directories: one per invocation, under `.lakatos/`.

A run's artifacts land in a directory named by the instant its envelope
reports as `startedAt`, so a report and its artifacts match by eye. The
directory is created when it is claimed, so the name is reserved rather
than merely observed free: no run is ever written on top of another's. -/

namespace Thales

/-- The root every run's artifacts land under. -/
def runRoot : System.FilePath := ".lakatos"

/-- The incremental tsc cache, under the run root but not of any one run:
clearing it between runs costs a cold program every time. -/
def typecheckCache : System.FilePath := runRoot / "typecheck.tsbuildinfo"

/-- The directory a run started at `startedAt` (an ISO 8601 instant)
wants. Colons are illegal in Windows paths, so they are spelled as
hyphens; the rest is kept, which keeps runs sortable and two runs a
millisecond apart in separate directories. -/
def runDirFor (startedAt : String) : System.FilePath :=
  runRoot / startedAt.replace ":" "-"

/-- How many names to try before concluding something is wrong with the
run root rather than with this one name: it would take this many
invocations inside a single millisecond. -/
def maxClaimAttempts : Nat := 100

/-- This invocation's run directory, or, when every name it would try is
taken, why not: the one failure a user can act on, reported like bad
input. Any other failure is not this run's to explain and is thrown as
is. Two invocations starting in the same millisecond want the same name
— ordinary in a shell loop — so an occupied one is stepped over, not
fought for, and the caller reports whichever name it got back. -/
def claimRunDir (startedAt : String) : IO (Except String System.FilePath) := do
  let base := runDirFor startedAt
  IO.FS.createDirAll runRoot
  for n in [1:maxClaimAttempts + 1] do
    let dir : System.FilePath := if n == 1 then base else s!"{base}-{n}"
    try
      -- Not createDirAll: failing on an existing directory is what makes
      -- the claim atomic, where checking first and creating after races.
      IO.FS.createDir dir
      return .ok dir
    catch
      | .alreadyExists .. => continue
      | e => throw e
  return .error s!"{base}: no free run directory after {maxClaimAttempts} attempts"

end Thales
