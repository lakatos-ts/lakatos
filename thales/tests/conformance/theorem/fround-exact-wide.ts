/** @ensures{exact} forall (x: int ∈ [0, 20000)) { narrow(x) === x } */
export function narrow(x: number): number {
  return Math.fround(x);
}
