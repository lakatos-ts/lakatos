export declare function shardOf<T>(
  items: readonly T[],
  spec: string | undefined,
): T[];

export declare function shardByWeight<T>(
  items: readonly T[],
  spec: string | undefined,
  weightOf: (item: T) => number,
): T[];
