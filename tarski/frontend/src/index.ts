/** Tarski's TypeScript surface: running the evaluator binary on an ESTree
 * document, which lemma's parser bridge produces. The test262 harness is
 * the `tarski-test262` bin, not an export. */
export {
  BUILD_TIMEOUT_MS,
  ensureBinary,
  runDocument,
  type BinaryResult,
  type Spawn,
  type SpawnOutcome,
} from "./binary.js";
export { findTarskiRoot } from "./test262/paths.js";
