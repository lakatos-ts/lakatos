/** Tarski's TypeScript surface: locating and building the evaluator
 * binary, which runs the ESTree documents lemma's parser bridge produces.
 * The test262 harness is the `tarski-test262` bin, not an export. */
export {
  BUILD_TIMEOUT_MS,
  ensureBinary,
  type BinaryResult,
  type Spawn,
  type SpawnOutcome,
} from "./binary.js";
export { findTarskiRoot } from "./test262/paths.js";
