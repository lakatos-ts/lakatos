import { describe, it, expect } from "vitest";
import {
  identityOf,
  interruptedResults,
  modelFor,
  unstatedModelReason,
  type ModelField,
  type PlannedProperty,
  type PropertyIdentity,
} from "../src/envelope.js";

const ID: PropertyIdentity = {
  file: "foo.ts",
  function: "clamp",
  property: "upper bound",
};

describe("identityOf", () => {
  it("drops planning detail so no envelope entry inherits it", () => {
    expect(identityOf({ ...ID, cases: 10 } as PlannedProperty)).toEqual(ID);
  });

  it("interrupted results never carry a case count", () => {
    expect(interruptedResults([{ ...ID, cases: 10 }], "SIGINT")).toEqual([
      { ...ID, szs: "User", reason: "the run was interrupted (SIGINT)" },
    ]);
  });
});

describe("modelFor", () => {
  const unvalidated: ModelField = {
    status: "unvalidated",
    reason: "budget: the attempt exceeded thales.validateHeartbeats = 1",
  };
  const validated: ModelField = { status: "validated" };

  it("every carrier gets the field, with a line and without", () => {
    for (const szs of [
      "Theorem",
      "GaveUp",
      "Timeout",
      "CounterSatisfiable",
      "Inappropriate",
    ] as const) {
      expect(modelFor(szs, unvalidated, "f")).toEqual(unvalidated);
      expect(modelFor(szs, undefined, "f")).toEqual({
        status: "unvalidated",
        reason: unstatedModelReason("f"),
      });
      expect(modelFor(szs, validated, "f")).toEqual({ status: "validated" });
    }
  });

  it("no other status carries the field", () => {
    for (const szs of ["Error", "NotTried", "InputError", "User"] as const)
      expect(modelFor(szs, unvalidated, "f")).toBeUndefined();
  });
});
