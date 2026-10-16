import Thales.Cli

open Thales

#guard parseArgs [] == .prove #[]
#guard parseArgs ["a.ts", "src/*.ts"] == .prove #["a.ts", "src/*.ts"]
-- Help anywhere in argv, in any spelling `parseArgs` accepts.
#guard parseArgs ["-h"] == .help
#guard parseArgs ["a.ts", "--help"] == .help
#guard parseArgs ["-hh", "a.ts"] == .help
-- `--` ends the options: what follows is a pattern, help included.
#guard parseArgs ["--", "-h", "-x.ts"] == .prove #["-h", "-x.ts"]
#guard parseArgs ["a.ts", "--", "--"] == .prove #["a.ts", "--"]
#guard parseArgs ["-"] == .prove #["-"]
-- Any other option is a usage error, and it outranks help.
#guard parseArgs ["--bogus"] == .usageError
#guard parseArgs ["-x", "a.ts"] == .usageError
#guard parseArgs ["-hx"] == .usageError
#guard parseArgs ["--help=yes"] == .usageError
#guard parseArgs ["-h", "--bogus"] == .usageError
-- `run-artifact` takes exactly one file.
#guard parseArgs ["run-artifact", "a.lean"] == .runArtifact "a.lean"
#guard parseArgs ["run-artifact", "--", "-a.lean"] == .runArtifact "-a.lean"
#guard parseArgs ["run-artifact"] == .usageError
#guard parseArgs ["run-artifact", "a.lean", "b.lean"] == .usageError
#guard parseArgs ["run-artifact", "-x"] == .usageError
#guard parseArgs ["run-artifact", "a.lean", "-h"] == .help
-- Only in first position is it the subcommand.
#guard parseArgs ["a.ts", "run-artifact"] == .prove #["a.ts", "run-artifact"]
