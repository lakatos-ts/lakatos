import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { BUILD_TIMEOUT_MS, ensureBinary, PACKAGE } from "./helpers/binary.js";

// The committed files, read structurally: the runner writes them with
// Lean's printer, so key order and spacing are not a contract.
const read = (name: string): string =>
  readFileSync(path.join(PACKAGE, "test262", name), "utf8");

interface Counts {
  pass: number;
  fail: number;
  unsupported: number;
  timeout: number;
  harnessError: number;
  notRun: Record<"noStrict" | "raw" | "async" | "module" | "budget", number>;
}

interface Summary {
  test262: { commit: string | null };
  slices: string[];
  directories: Record<string, Counts>;
  totals: Counts;
  skipped: Record<string, number>;
}

const slices = (): string[] =>
  read("slice.txt")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

describe("the committed files", () => {
  it("pins a 40-hex-digit commit", () => {
    const pin = JSON.parse(read("pin.json")) as {
      repository: string;
      commit: string;
    };
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.repository).toContain("test262");
  });

  it("holds the harness slice's counts in the shape --check reads", () => {
    const expectations = JSON.parse(read("expected.json")) as {
      directories: Record<string, Counts>;
    };
    const harness = expectations.directories["test/harness"];
    if (harness === undefined) throw new Error("no test/harness row");
    for (const field of [
      "pass",
      "fail",
      "unsupported",
      "timeout",
      "harnessError",
    ] as const)
      expect(Number.isInteger(harness[field])).toBe(true);
    for (const reason of [
      "noStrict",
      "raw",
      "async",
      "module",
      "budget",
    ] as const)
      expect(Number.isInteger(harness.notRun[reason])).toBe(true);
    expect(harness.pass + harness.fail + harness.unsupported).toBeGreaterThan(
      0,
    );
  });

  it("names only slices the expectations file has rows for", () => {
    const directories = Object.keys(
      (
        JSON.parse(read("expected.json")) as {
          directories: Record<string, Counts>;
        }
      ).directories,
    );
    expect(slices().length).toBeGreaterThan(0);
    for (const slice of slices()) {
      expect({
        slice,
        covered: directories.some(
          (d) => d === slice || d.startsWith(`${slice}/`),
        ),
      }).toEqual({ slice, covered: true });
    }
  });

  // What holds the table to the pin: the runner only warns when a
  // checkout is somewhere else.
  it("holds a results table run at the pin over the script's slices", () => {
    const pin = JSON.parse(read("pin.json")) as { commit: string };
    const summary = JSON.parse(read("results.json")) as Summary;
    expect(summary.test262).toEqual({ commit: pin.commit });
    expect(summary.slices).toEqual([
      "test/language",
      "test/built-ins",
      "test/intl402",
    ]);
    expect(Object.keys(summary.skipped).sort()).toEqual([
      "intl402",
      "parse-negative",
      "resolution-negative",
    ]);
    expect(summary.skipped.intl402).toBeGreaterThan(0);
    expect(Object.keys(summary.directories)).not.toContain("test/intl402");
    expect(summary.totals.unsupported).toBeGreaterThan(0);
  });

  it("holds a results document naming that same commit", () => {
    const pin = JSON.parse(read("pin.json")) as { commit: string };
    const document = read("results.md");
    expect(document.startsWith("# test262 results\n")).toBe(true);
    expect(document).toContain(pin.commit);
    expect(document).toContain("## Not run and skipped");
  });
});

// The built runner, run the way a person runs it.
describe.runIf(process.env.LAKATOS_TARSKI_E2E === "1")(
  "the built tarski-test262",
  () => {
    let runner = "";
    beforeAll(() => {
      const built = ensureBinary("tarski-test262");
      expect(built.kind, JSON.stringify(built)).toBe("ready");
      if (built.kind === "ready") runner = built.binary;
    }, BUILD_TIMEOUT_MS + 60_000);

    it("runs the fake tree", () => {
      const r = spawnSync(
        runner,
        [
          "test/pass",
          "--test262",
          path.join(PACKAGE, "Test", "fixtures", "test262"),
          "--binary",
          path.join(PACKAGE, "Test", "fixtures", "fake-tarski.sh"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            LAKATOS_LEMMA: path.join(
              path.dirname(path.resolve(PACKAGE)),
              "lemma",
            ),
          },
        },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(
        "test/pass     6     0            0        0              0        0",
      );
    });

    it("exits 2 on a usage error", () => {
      const r = spawnSync(runner, [], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("at least one slice is needed");
    });
  },
);
