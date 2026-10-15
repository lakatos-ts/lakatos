import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { enabled, proveTimeoutMs, runMain } from "./helpers/cli.js";

describe.runIf(enabled)("the thales binary", () => {
  it("--help prints the usage on stdout and exits 0", async () => {
    const { code, stdout } = await runMain(["--help"]);
    expect(stdout[0]).toMatch(/^usage: thales/);
    expect(code).toBe(0);
  });

  it("an unknown option prints the usage on stderr and exits 2", async () => {
    const { code, stdout, stderr } = await runMain(["--bogus"]);
    expect(stdout).toEqual([]);
    expect(stderr[0]).toMatch(/^usage: thales/);
    expect(code).toBe(2);
  });

  it(
    "run-artifact prints one artifact's parsed verdict channel",
    async () => {
      const fixture = path.join(
        "thales",
        "tests",
        "fixtures",
        "verdict-channel.lean",
      );
      const { code, stdout } = await runMain(["run-artifact", fixture]);
      expect(code).toBe(0);
      const channel = JSON.parse(stdout[0]!);
      expect(
        channel.verdicts.map(
          (v: { identity: [string, string, string] }) => v.identity[1],
        ),
      ).toEqual(["add", "sub", "bad", "tail"]);
      expect(channel.messages).toEqual([]);
    },
    proveTimeoutMs(1),
  );
});
