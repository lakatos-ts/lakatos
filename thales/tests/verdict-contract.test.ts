import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const verdictLean = readFileSync(
  fileURLToPath(new URL("../ThalesDsl/Verdict.lean", import.meta.url)),
  "utf8",
);

/** The constructors of `inductive <name>`. */
function constructors(name: string): string[] {
  const decl = verdictLean.match(
    new RegExp(`inductive ${name} where\\n([\\s\\S]*?)\\n\\s*deriving`),
  );
  expect(decl, `the ${name} declaration was not found`).not.toBeNull();
  return [...decl![1]!.matchAll(/\|\s*(\w+)/g)].map((m) => m[1]!);
}

/** The `[constructor, wire spelling]` arms of `def <name>.toString`. */
function wireArms(name: string): (readonly [string, string])[] {
  const body = verdictLean.match(
    new RegExp(`def ${name}\\.toString[\\s\\S]*?\\n\\n`),
  );
  expect(body, `${name}.toString was not found`).not.toBeNull();
  return [...body![0].matchAll(/\|\s*\.(\w+)\s*=>\s*"([^"]+)"/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  );
}

describe("verdict-channel contract", () => {
  it("every status goes on the wire under its own name", () => {
    const arms = wireArms("Szs");
    expect(new Set(arms.map(([name]) => name))).toEqual(
      new Set(constructors("Szs")),
    );
    for (const [name, wire] of arms) expect(wire).toBe(name);
  });
});

describe("model-channel contract", () => {
  it("every model status goes on the wire under its own name", () => {
    const arms = wireArms("ModelStatus");
    expect(new Set(arms.map(([name]) => name))).toEqual(
      new Set(constructors("ModelStatus")),
    );
    for (const [name, wire] of arms) expect(wire).toBe(name);
  });

  it("the model line declares exactly the fields the CLI reads", () => {
    const decl = verdictLean.match(/structure ModelLine where\n([\s\S]*?)\n\n/);
    expect(decl, "the ModelLine structure was not found").not.toBeNull();
    const fields = [...decl![1]!.matchAll(/^ {2}(\w+) :/gm)].map((m) => m[1]);
    expect(fields).toEqual(["file", "function", "status", "reason"]);
  });
});
