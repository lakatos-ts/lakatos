import Thales.Main

-- The command line as Node's `parseArgs` read it for the TypeScript tool.
#guard parseArgs [] == some (false, #[])
#guard parseArgs ["a.ts", "src/*.ts"] == some (false, #["a.ts", "src/*.ts"])
#guard parseArgs ["-h"] == some (true, #[])
#guard parseArgs ["a.ts", "--help"] == some (true, #["a.ts"])
-- An unknown option is a usage error even beside --help.
#guard parseArgs ["--nope", "--help"] == none
#guard parseArgs ["-x"] == none
-- `--` ends the options; a bare `-` is a positional.
#guard parseArgs ["--", "-x.ts"] == some (false, #["-x.ts"])
#guard parseArgs ["-"] == some (false, #["-"])
