#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LemmaError } from "@lakatos/lemma";
import { RunDirError } from "@lakatos/core/run-dir";
import { prove } from "./prove.js";

const USAGE = "usage: thales [files-or-globs...]";

const HELP = `${USAGE}

emit Lean for each file and attempt a proof per @ensures annotation, then
print a JSON report to stdout. artifacts land in .lakatos/<run>/thales/.
needs a lakatos checkout with the Lean toolchain.

when no files are given, thales discovers your sources: the files that
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
  -h, --help  show this help`;

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  let positionals: string[];
  let values: { help?: boolean };
  try {
    ({ positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { help: { type: "boolean", short: "h" } },
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
    /* v8 ignore next -- parseArgs throws only its ERR_PARSE_ARGS_ errors */
    throw e;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  // Bad input maps to exit 2; anything else is an internal bug and crashes.
  try {
    return (await prove(positionals)).code;
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
/* v8 ignore start -- runs only in the spawned bin, which cli-bin.test.ts drives */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exit(await main());
}
/* v8 ignore stop */
