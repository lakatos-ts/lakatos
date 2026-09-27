/** Thales's programmatic surface: prove annotated TypeScript and get the
 * envelope back. Needs a lakatos checkout with the Lean toolchain. */
export { prove } from "./prove.js";
export type { ProveOptions } from "./prove.js";
export { findEngineRoot } from "./run.js";
export { main as exeMain } from "./exe-cli.js";
export type { RunReport, ToolIo } from "@lakatos/core/runner";
export type { AnnotationResult, Envelope } from "@lakatos/core/envelope";
