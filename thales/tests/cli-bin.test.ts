import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const root = process.cwd();
const cliJs = path.join(root, "thales", "dist", "cli.js");

// npm exposes the bin as a symlink (node_modules/.bin/thales ->
// thales/dist/cli.js), so these run the built bin the way an installed copy
// runs: argv[1] names the symlink, not the real file. The build itself is
// the suite-wide globalSetup's.
describe("thales/dist/cli.js as an installed bin", () => {
  it("starts with an env-node shebang", () => {
    const firstLine = fs.readFileSync(cliJs, "utf8").split("\n", 1)[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("runs main() when invoked through a .bin-style symlink", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thales-bin-"));
    const link = path.join(dir, "thales");
    fs.symlinkSync(cliJs, link);
    try {
      const r = spawnSync(process.execPath, [link, "--help"], {
        encoding: "utf8",
      });
      expect(r.stdout).toMatch(/^usage: thales/);
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
