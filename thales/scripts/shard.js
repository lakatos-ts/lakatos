// Round-robin rather than contiguous blocks: the manifest is ordered by
// slice, and contiguous blocks would put every class fixture in one shard.
export function shardOf(items, spec) {
  if (spec === undefined || spec === "") return items;
  const { index, count } = parseShard(spec);
  return items.filter((_, i) => i % count === index - 1);
}

function parseShard(spec) {
  const m = /^(\d+)\/(\d+)$/.exec(spec);
  if (m === null) {
    throw new Error(`shard spec must look like "2/3", got: ${spec}`);
  }
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (count < 1) throw new Error(`shard count must be at least 1: ${spec}`);
  if (index < 1 || index > count) {
    throw new Error(`shard index out of range for ${count} shards: ${spec}`);
  }
  return { index, count };
}

// One fixture can outweigh the rest put together, which round-robin by
// position cannot balance. Heaviest first onto the lightest shard so far;
// ties keep input order, so the assignment is deterministic and each shard
// reads in the order the list was written.
export function shardByWeight(items, spec, weightOf) {
  if (spec === undefined || spec === "") return items;
  const { index, count } = parseShard(spec);
  const order = items
    .map((item, i) => ({ i, w: weightOf(item) }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  const loads = new Array(count).fill(0);
  const shardOfIndex = new Array(items.length);
  for (const { i, w } of order) {
    let lightest = 0;
    for (let s = 1; s < count; s += 1) {
      if (loads[s] < loads[lightest]) lightest = s;
    }
    loads[lightest] += w;
    shardOfIndex[i] = lightest;
  }
  return items.filter((_, i) => shardOfIndex[i] === index - 1);
}
