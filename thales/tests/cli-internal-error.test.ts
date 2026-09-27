import { describe, it, expect, vi } from "vitest";
import { runMain, useTempProject } from "./helpers/cli.js";

// Only bad input maps to exit 2. An internal bug (anything that is not a
// LemmaError or RunDirError) must keep crashing loudly, so simulate one by
// making the emitter throw a TypeError.
vi.mock("../frontend/src/emission-artifacts.js", () => ({
  writeEmissionArtifacts: () => {
    throw new TypeError("internal invariant violated");
  },
}));

describe("thales internal errors", () => {
  useTempProject("thales-cli-internal-", {
    "fine.ts": `/** @ensures{pos} forall (n: nat) { fine(n) >= 0 } */\nexport function fine(n: number): number { return n; }\n`,
  });

  it("a non-LemmaError from emission escapes main() instead of exiting 2", async () => {
    await expect(runMain(["fine.ts"])).rejects.toThrow(TypeError);
  });
});
