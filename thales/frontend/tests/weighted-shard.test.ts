import { describe, it, expect } from "vitest";
import { shardByWeight } from "../../scripts/shard.js";

const weight = (item: { w?: number }) => item.w ?? 1;

describe("shardByWeight", () => {
  it("returns everything when the spec is undefined", () => {
    const items = [{ w: 1 }, { w: 2 }];
    expect(shardByWeight(items, undefined, weight)).toEqual(items);
  });

  it("gives every item to exactly one shard", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i, w: 1 }));
    const shards = [1, 2, 3].map((i) => shardByWeight(items, `${i}/3`, weight));
    const ids = shards
      .flat()
      .map((x) => x.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(items.map((x) => x.id));
  });

  it("puts one heavy item on a shard of its own when the rest fit elsewhere", () => {
    const items = [
      ...Array.from({ length: 21 }, (_, i) => ({ id: i, w: 1 })),
      { id: 21, w: 20 },
    ];
    const shards = [1, 2, 3].map((i) => shardByWeight(items, `${i}/3`, weight));
    const heavy = shards.find((s) => s.some((x) => x.id === 21))!;
    expect(heavy).toHaveLength(1);
    const light = shards.filter((s) => s !== heavy).map((s) => s.length);
    expect(light.sort()).toEqual([10, 11]);
  });

  it("keeps each shard in the input's order", () => {
    const items = [
      { id: 0, w: 3 },
      { id: 1, w: 1 },
      { id: 2, w: 1 },
      { id: 3, w: 1 },
    ];
    for (const i of [1, 2]) {
      const ids = shardByWeight(items, `${i}/2`, weight).map((x) => x.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    }
  });

  it("is deterministic across calls", () => {
    const items = Array.from({ length: 22 }, (_, i) => ({
      id: i,
      w: i === 7 ? 20 : 1,
    }));
    const a = shardByWeight(items, "1/3", weight).map((x) => x.id);
    const b = shardByWeight(items, "1/3", weight).map((x) => x.id);
    expect(a).toEqual(b);
  });

  it("refuses a malformed spec", () => {
    expect(() => shardByWeight([{ w: 1 }], "half", weight)).toThrow(
      /shard spec/,
    );
  });
});
