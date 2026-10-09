import { b } from "./dep.js";

/** @ensures{positive} forall (x: int ∈ [0, 5)) { top(x) > 0 } */
export function top(x: number): number {
  return b(x);
}
