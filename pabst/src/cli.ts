#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LemmaError } from "@lakatos/lemma";
import { RunDirError } from "@lakatos/core/run-dir";
import { refute } from "./refute.js";
import { parseSeed } from "./seed.js";

const USAGE = "usage: pabst [--seed <n>] [files-or-globs...]";

const HELP = `${USAGE}

generate property tests from @ensures annotations, run them, and print a
JSON report to stdout

when no files are given, pabst discovers your sources: the files that
tsconfig.json would compile. declaration files (.d.ts) are skipped unless a
pattern names them.

every run type checks the whole project first, under the project's own
tsconfig.json with lakatos's required options (strict) forced on top. a
program that does not compile is refused (annotations report InputError,
exit 2); a run without a tsconfig.json is refused the same way, and so is
any named file the tsconfig's program leaves out.

exit status: 0 when nothing was refuted, 1 when something was, 2 on bad
input, an engine failure, or an interrupted run.

options:
  --seed <n>  reproduce a prior run's generation (echoed in the report)
  -h, --help  show this help`;

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let positionals: string[];
  let values: { seed?: string; help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        seed: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }));
  } catch (e) {
    if (
      e instanceof TypeError &&
      "code" in e &&
      typeof e.code === "string" &&
      e.code.startsWith("ERR_PARSE_ARGS_")
    ) {
      console.error(USAGE);
      return 2;
    }
    throw e;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  // Bad input maps to exit 2; anything else is an internal bug and crashes.
  try {
    // Parsed first, so a bad seed is reported without resolving files.
    const options =
      values.seed !== undefined ? { seed: parseSeed(values.seed) } : {};
    return (await refute(positionals, options)).code;
  } catch (e) {
    if (e instanceof LemmaError || e instanceof RunDirError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

// npm installs the bin as a symlink; Node resolves the main module to its
// realpath but argv[1] keeps the link, so compare realpaths.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exit(await main());
}
