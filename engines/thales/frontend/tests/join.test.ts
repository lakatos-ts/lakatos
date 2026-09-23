import { describe, it, expect } from "vitest";
import type { ProveStatus } from "@lakatos-ts/core/szs";
import {
  unstatedModelReason,
  type AnnotationResult,
  type PlannedProperty,
  type PropertyIdentity,
} from "@lakatos-ts/core/envelope";
import {
  joinProveVerdicts,
  type ProveModelLine,
  type ProveVerdict,
} from "../src/join.js";

const IDS: PropertyIdentity[] = [
  { file: "foo.ts", function: "clamp", property: "upper bound" },
  { file: "foo.ts", function: "clamp", property: "lower bound" },
  { file: "foo.ts", function: "abs", property: "non-negative" },
];

describe("joinProveVerdicts", () => {
  const id = (fn: string): PropertyIdentity => ({
    file: "t.ts",
    function: fn,
    property: "p",
  });
  const verdict = (
    fn: string,
    szs: ProveStatus,
    reason = "r",
  ): ProveVerdict => ({
    identity: ["t.ts", fn, "p"],
    szs,
    reason,
  });
  const validated = (fn: string): ProveModelLine => ({
    file: "t.ts",
    function: fn,
    status: "validated",
  });
  const unvalidated = (fn: string, reason: string): ProveModelLine => ({
    file: "t.ts",
    function: fn,
    status: "unvalidated",
    reason,
  });
  /** What a declaration the artifact printed no model line for gets. */
  const unstated = (fn: string) => ({
    status: "unvalidated" as const,
    reason: unstatedModelReason(fn),
  });
  const annotationsOf = (join: ReturnType<typeof joinProveVerdicts>) => {
    expect(join.kind).toBe("joined");
    return (join as { annotations: AnnotationResult[] }).annotations;
  };

  it("maps each status to its envelope shape", () => {
    const join = joinProveVerdicts(
      [id("a"), id("b"), id("c"), id("d"), id("e")],
      [
        verdict(
          "a",
          "Theorem",
          "proved by a decision procedure over the bounded domain, kernel-checked as X",
        ),
        verdict("b", "Inappropriate", "await is unmapped"),
        verdict("c", "Error", "elaboration failed"),
        verdict("d", "GaveUp", "decide failed"),
        verdict("e", "NotTried", "no structured property"),
      ],
      [],
    );
    expect(join).toEqual({
      kind: "joined",
      annotations: [
        { ...id("a"), szs: "Theorem", axioms: [], model: unstated("a") },
        {
          ...id("b"),
          szs: "Inappropriate",
          reason: "await is unmapped",
          model: unstated("b"),
        },
        // Error and NotTried stay bare: the schema has no model there.
        { ...id("c"), szs: "Error", error: "elaboration failed" },
        {
          ...id("d"),
          szs: "GaveUp",
          reason: "decide failed",
          model: unstated("d"),
        },
        { ...id("e"), szs: "NotTried", reason: "no structured property" },
      ],
    });
  });

  it("order follows the identities, not the verdict lines", () => {
    const join = joinProveVerdicts(
      [id("a"), id("b")],
      [verdict("b", "Theorem"), verdict("a", "Theorem")],
      [],
    );
    expect(join.kind).toBe("joined");
    expect(
      (join as { annotations: AnnotationResult[] }).annotations.map(
        (a) => a.function,
      ),
    ).toEqual(["a", "b"]);
  });

  it("a missing verdict is a mismatch naming the annotation", () => {
    const join = joinProveVerdicts(
      [id("a"), id("b")],
      [verdict("a", "Theorem")],
      [],
    );
    expect(join.kind).toBe("mismatched");
    expect((join as { messages: string[] }).messages.join("\n")).toContain(
      '"b"',
    );
  });

  it("a surplus verdict is a mismatch", () => {
    expect(
      joinProveVerdicts(
        [id("a")],
        [verdict("a", "Theorem"), verdict("ghost", "Theorem")],
        [],
      ).kind,
    ).toBe("mismatched");
  });

  it("a duplicate verdict is a mismatch", () => {
    expect(
      joinProveVerdicts(
        [id("a")],
        [verdict("a", "Theorem"), verdict("a", "GaveUp")],
        [],
      ).kind,
    ).toBe("mismatched");
  });

  it("a Theorem verdict ships the axioms its proof rests on", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [{ ...verdict("a", "Theorem"), axioms: ["Lean.ofReduceBool"] }],
      [],
    );
    expect(join).toEqual({
      kind: "joined",
      annotations: [
        {
          ...id("a"),
          szs: "Theorem",
          axioms: ["Lean.ofReduceBool"],
          model: unstated("a"),
        },
      ],
    });
  });

  it("a CounterSatisfiable verdict ships kind falsified and the counterexample", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [
        {
          ...verdict("a", "CounterSatisfiable", "false on its bounded domain"),
          counterexample: { x: 0, y: "9007199254740992" },
        },
      ],
      [],
    );
    expect(join).toEqual({
      kind: "joined",
      annotations: [
        {
          ...id("a"),
          szs: "CounterSatisfiable",
          kind: "falsified",
          counterexample: { x: 0, y: "9007199254740992" },
          model: unstated("a"),
        },
      ],
    });
  });

  it("a boolean witness value ships in the falsified shape unchanged", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [
        {
          ...verdict("a", "CounterSatisfiable", "false on its bounded domain"),
          counterexample: { n: 1, b: false },
        },
      ],
      [],
    );
    expect(join).toMatchObject({
      kind: "joined",
      annotations: [
        {
          szs: "CounterSatisfiable",
          kind: "falsified",
          counterexample: { n: 1, b: false },
        },
      ],
    });
  });

  it("a CounterSatisfiable verdict without a counterexample is a mismatch", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "CounterSatisfiable")],
      [],
    );
    expect(join.kind).toBe("mismatched");
    expect((join as { messages: string[] }).messages.join("\n")).toContain(
      "counterexample",
    );
  });

  it("a CounterSatisfiable verdict with an empty counterexample is a mismatch", () => {
    // The envelope schema requires a non-empty counterexample object, so
    // an empty one must not ship on a healthy run.
    const join = joinProveVerdicts(
      [id("a")],
      [{ ...verdict("a", "CounterSatisfiable"), counterexample: {} }],
      [],
    );
    expect(join.kind).toBe("mismatched");
    expect((join as { messages: string[] }).messages.join("\n")).toContain(
      "counterexample",
    );
  });

  it("a status the envelope cannot represent is a mismatch", () => {
    // Only a broken engine sends this, so the type has to be forced.
    const bogus = verdict("a", "Unknown" as ProveStatus);
    expect(joinProveVerdicts([id("a")], [bogus], []).kind).toBe("mismatched");
  });

  it("a Timeout verdict joins with its reason", () => {
    const join = joinProveVerdicts([id("a")], [verdict("a", "Timeout")], []);
    expect(join.kind).toBe("joined");
  });

  it("a validated model line lands on the Theorem it belongs to", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "Theorem")],
      [validated("a")],
    );
    expect(annotationsOf(join)[0]).toEqual({
      ...id("a"),
      szs: "Theorem",
      axioms: [],
      model: { status: "validated" },
    });
  });

  it("an unvalidated model line lands with its reason verbatim", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "Theorem")],
      [unvalidated("a", "'**' is not supported")],
    );
    expect(annotationsOf(join)[0]!.model).toEqual({
      status: "unvalidated",
      reason: "'**' is not supported",
    });
  });

  it("one line serves every status that carries the field", () => {
    // One declaration, one obligation, several annotations of it.
    const many: PropertyIdentity[] = [
      { file: "t.ts", function: "a", property: "p" },
      { file: "t.ts", function: "a", property: "q" },
      { file: "t.ts", function: "a", property: "r" },
      { file: "t.ts", function: "a", property: "s" },
    ];
    const join = joinProveVerdicts(
      many,
      [
        { identity: ["t.ts", "a", "p"], szs: "GaveUp", reason: "r" },
        { identity: ["t.ts", "a", "q"], szs: "Timeout", reason: "r" },
        { identity: ["t.ts", "a", "r"], szs: "Inappropriate", reason: "r" },
        {
          identity: ["t.ts", "a", "s"],
          szs: "CounterSatisfiable",
          reason: "r",
          counterexample: { x: 0 },
        },
      ],
      [unvalidated("a", "the run of 'a' did not reduce to its model")],
    );
    for (const a of annotationsOf(join))
      expect(a.model).toEqual({
        status: "unvalidated",
        reason: "the run of 'a' did not reduce to its model",
      });
  });

  it("a Theorem with no model line says no obligation was stated", () => {
    const join = joinProveVerdicts([id("a")], [verdict("a", "Theorem")], []);
    expect(annotationsOf(join)[0]!.model).toEqual({
      status: "unvalidated",
      reason: "no correspondence obligation was stated for 'a'",
    });
  });

  it("an Error and a NotTried carry no model even with a line", () => {
    const join = joinProveVerdicts(
      [id("a"), id("b")],
      [verdict("a", "Error"), verdict("b", "NotTried")],
      [validated("a"), validated("b")],
    );
    for (const a of annotationsOf(join)) expect(a).not.toHaveProperty("model");
  });

  it("a model line for a function no annotation names is ignored", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "Theorem")],
      [validated("a"), validated("ghost")],
    );
    expect(join.kind).toBe("joined");
    expect(annotationsOf(join)[0]!.model).toEqual({ status: "validated" });
  });

  it("two model lines for one declaration are a mismatch naming it", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "Theorem")],
      [validated("a"), unvalidated("a", "budget")],
    );
    expect(join.kind).toBe("mismatched");
    expect((join as { messages: string[] }).messages.join("\n")).toContain(
      'duplicate model line for ["t.ts","a"]',
    );
  });

  it("a line for the same name in another file does not travel", () => {
    const join = joinProveVerdicts(
      [id("a")],
      [verdict("a", "Theorem")],
      [{ file: "other.ts", function: "a", status: "validated" }],
    );
    expect(annotationsOf(join)[0]!.model).toEqual(unstated("a"));
  });
});

describe("joinProveVerdicts and planning detail", () => {
  it("a prover verdict never inherits the plan's case count", () => {
    const planned: PlannedProperty = { ...IDS[0]!, cases: 10 };
    const join = joinProveVerdicts(
      [planned],
      [
        {
          identity: [IDS[0]!.file, IDS[0]!.function, IDS[0]!.property],
          szs: "Theorem",
          reason: "kernel-checked",
        },
      ],
      [],
    );
    expect(join).toEqual({
      kind: "joined",
      annotations: [
        {
          ...IDS[0],
          szs: "Theorem",
          axioms: [],
          model: {
            status: "unvalidated",
            reason: unstatedModelReason(IDS[0]!.function),
          },
        },
      ],
    });
  });
});
