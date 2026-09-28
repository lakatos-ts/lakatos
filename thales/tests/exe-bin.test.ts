import { describe, expect, it } from "vitest";
import { runExeRaw } from "./helpers/cli.js";

describe("the thales-exe bin", () => {
  it("thales-exe --help states the evaluator's honesty limits", async () => {
    const r = await runExeRaw(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^usage: thales-exe <file\.ts>/);
    expect(r.stdout).toContain(
      "checked against the\nevaluator per declaration",
    );
    expect(r.stdout).toContain("refute runs on Node");
  });

  it("-h is --help", async () => {
    expect((await runExeRaw(["-h"])).stdout).toBe(
      (await runExeRaw(["--help"])).stdout,
    );
  });

  it("exits 2 with usage on an unknown option", async () => {
    const r = await runExeRaw(["--seed", "3"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toBe("usage: thales-exe <file.ts>\n");
  });

  it("exits 2 with an error line when no file matches", async () => {
    const r = await runExeRaw(["no-such-file-anywhere.ts"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^error: /m);
  });
});
