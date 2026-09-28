import { describe, it, expect, vi } from "vitest";
import { parseArgs } from "node:util";
import { runExeRaw, useTempProject } from "./helpers/cli.js";

// Only bad input maps to exit 2; an internal bug must keep crashing loudly.
vi.mock("node:util", async (importActual) => {
  const actual = await importActual<typeof import("node:util")>();
  return { ...actual, parseArgs: vi.fn(actual.parseArgs) };
});
vi.mock("../frontend/src/exe.js", () => ({
  executeSource: () => {
    throw new TypeError("internal invariant violated");
  },
}));

describe("thales-exe internal errors", () => {
  useTempProject("thales-exe-internal-", {
    "fine.ts": "export const one = 1;\n",
  });

  it("lets an error that is not a usage error escape", async () => {
    vi.mocked(parseArgs).mockImplementationOnce(() => {
      throw new RangeError("not a parse error");
    });
    await expect(runExeRaw(["fine.ts"])).rejects.toThrow(RangeError);
  });

  it("lets a non-LemmaError from the run escape instead of exiting 2", async () => {
    await expect(runExeRaw(["fine.ts"])).rejects.toThrow(TypeError);
  });
});
