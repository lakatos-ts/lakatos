import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const spec = readFileSync(
  new URL("../spec/semantics.md", import.meta.url),
  "utf8",
);

const HEADING = "### What a Theorem rests on";

/** The published conformance table, in the thales repository. */
const RESULTS =
  "https://github.com/lakatos-ts/thales/blob/main/test262/results.md";

/** From a heading to the next heading at the same level or above, or to EOF. */
function section(text: string, heading: string, stop: RegExp): string {
  const start = text.indexOf(heading);
  expect(start, `${heading} is missing`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + heading.length);
  const end = stop.exec(rest);
  return heading + (end === null ? rest : rest.slice(0, end.index));
}

const trust = section(spec, HEADING, /^## /m);

describe("the trust section", () => {
  it("appears once, under the verdict section", () => {
    expect(spec.match(/^### What a Theorem rests on$/gm)).toHaveLength(1);
    const verdicts = spec.indexOf("## Verdicts and SZS statuses");
    const here = spec.indexOf(HEADING);
    expect(verdicts).toBeGreaterThanOrEqual(0);
    expect(here).toBeGreaterThan(verdicts);
    expect(
      spec.slice(verdicts + 1, here).match(/^## /m),
      "a later `##` section opened before the trust section: it is no longer " +
        "part of Verdicts and SZS statuses",
    ).toBeNull();
  });

  it("links the committed test262 results table", () => {
    const targets = [...trust.matchAll(/\]\(([^)]+)\)/g)].map(([, t]) => t!);
    expect(
      targets,
      "the section must link thales's results table; if it moved, repoint " +
        "this link (and thales/CLAUDE.md's note about it)",
    ).toContain(RESULTS);
  });

  it("states the two limits", () => {
    expect(trust).toMatch(/only the primitives are shared/i);
    expect(trust).toMatch(/runs on Node/);
    expect(trust).toMatch(/V8/);
  });

  it("names the field a reader checks the first limit against", () => {
    expect(trust).toMatch(/`model`/);
  });

  it("names no tactic, Lean version, or internal module", () => {
    const forbidden = [
      "native_decide",
      "decide",
      "simp",
      "omega",
      "partial_fixpoint",
      "ThalesDsl",
      "#thales_prove",
      "Js/",
      "Tarski/",
      ".lean",
    ];
    expect(forbidden.filter((word) => trust.includes(word))).toEqual([]);
    expect(trust).not.toMatch(/\bv?4\.\d+\.\d+/);
  });

  it("is what the islands section points forward to", () => {
    expect(spec).not.toContain("trust reporting below");
    expect(
      section(spec, "### Islands (host expressions)", /^#{2,3} /m),
    ).toMatch(/What a Theorem rests on\* below/);
  });
});
