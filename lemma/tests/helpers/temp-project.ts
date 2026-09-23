import { beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** The tsconfig a scratch project gets when a suite supplies none: enough
 * for tsc to describe the program (lemma forces strict itself). Excludes
 * the run root so generated artifacts never join the program. */
const DEFAULT_TSCONFIG = JSON.stringify({
  compilerOptions: { target: "es2022", module: "nodenext", types: [] },
  include: ["**/*.ts"],
  exclude: [".lakatos"],
});

/**
 * Create a temp directory populated with `files` and chdir into it for the
 * duration of the enclosing describe block (registers beforeAll/afterAll).
 * Returns the directory path.
 */
export function useTempProject(
  prefix: string,
  files: Record<string, string>,
  opts: { tsconfig?: boolean } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const prevCwd = process.cwd();
  beforeAll(() => {
    for (const [name, text] of Object.entries(files)) {
      const dest = path.join(dir, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text, "utf8");
    }
    if (opts.tsconfig !== false) {
      const dest = path.join(dir, "tsconfig.json");
      if (!fs.existsSync(dest))
        fs.writeFileSync(dest, DEFAULT_TSCONFIG, "utf8");
    }
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
