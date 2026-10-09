import { double, inc } from "./index.js";

/** @ensures{affine} forall (x: int ∈ [0, 20)) { through(x) === 3 * x + 1 } */
export function through(x: number): number {
  return double(x) + inc(x);
}
