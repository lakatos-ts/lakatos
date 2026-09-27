/** Tarski's TypeScript surface: the bridge from TypeScript source to the
 * evaluator's ESTree JSON, and running the evaluator binary on it. The
 * test262 harness is the `tarski-test262` bin, not an export. */
export * from "./estree.js";
export { stripTypes } from "./strip-types.js";
export {
  BUILD_TIMEOUT_MS,
  ensureBinary,
  runDocument,
  type BinaryResult,
  type Spawn,
  type SpawnOutcome,
} from "./binary.js";
export { findTarskiRoot } from "./test262/paths.js";
