/** @ensures{below} forall (x: int ∈ [0, 20000)) { dbl(x) < 39998 } */
export function dbl(x: number): number {
  return x * 2;
}
