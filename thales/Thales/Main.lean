import Thales.Cli
import Thales.Prove

open Thales in
unsafe def main (args : List String) : IO UInt32 := do
  match parseArgs args with
  | .help => IO.println help; return 0
  | .usageError => IO.eprintln usage; return 2
  | .runArtifact file => runArtifactCommand file
  | .prove patterns => prove patterns
