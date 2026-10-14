#!/usr/bin/env node
// The `lemma` bin: files in, one checked-program document per file out.
// This is the front end's process boundary — what an engine that is not
// written in TypeScript runs to get a program `tsc` has vouched for.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type CheckedDocument,
  checkDocuments,
  parseDocument,
} from "./document.js";

const USAGE = `usage: lemma check [--jsonl] [--tsbuildinfo <file>] <file.ts>...
       lemma parse [--jsonl] <file.js>...`;

const HELP = `${USAGE}

print the checked-program document for each file (the schema is
schemas/lemma-document.schema.json in this package).

  check  type check the project under ./tsconfig.json with lakatos's
         required options (strict) forced on top, then strip each
         file's types and parse what is left as a script.
  parse  parse each file as a JavaScript script, exactly as written,
         with no type check.

a file that is refused still gets a document, which says why.

options:
  --jsonl               one compact document per line, for any number of
                        files; without it, exactly one file, printed
                        indented
  --tsbuildinfo <file>  check reads and writes the gate's incremental
                        cache here
  -h, --help            show this help

exit status: 0 when every file has a program, 1 when any was refused,
2 on bad usage.`;

function usage(): number {
  console.error(USAGE);
  return 2;
}

export function main(argv: readonly string[], cwd = process.cwd()): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        jsonl: { type: "boolean" },
        tsbuildinfo: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    // parseArgs throws a TypeError naming the unknown or malformed option.
    console.error(`lemma: ${(e as Error).message}`);
    return usage();
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const [command, ...files] = positionals;
  if (command !== "check" && command !== "parse") return usage();
  if (files.length === 0 || (!values.jsonl && files.length !== 1))
    return usage();
  if (command === "parse" && values.tsbuildinfo !== undefined) return usage();

  const documents: CheckedDocument[] =
    command === "check"
      ? checkDocuments(files, cwd, values.tsbuildinfo)
      : files.map((f) => parseDocument(f, cwd));
  for (const d of documents)
    process.stdout.write(
      values.jsonl
        ? `${JSON.stringify(d)}\n`
        : `${JSON.stringify(d, null, 2)}\n`,
    );
  return documents.every((d) => d.outcome === "program") ? 0 : 1;
}

// npm may install this behind a symlink, and Node resolves the main
// module to its realpath while argv[1] keeps the link.
/* v8 ignore start -- true only when node runs this file, which the
   suite does out of process, where this process's counters cannot see
   it. */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.exit(main(process.argv.slice(2)));
}
/* v8 ignore stop */
