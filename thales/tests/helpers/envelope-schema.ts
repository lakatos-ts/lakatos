import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { schemaValidator } from "./schema-validator.js";

/** Fail the current test if `value` does not match core's envelope schema,
 * reached through core's own export rather than a path into its tree. */
export const expectValidEnvelope = schemaValidator(
  pathToFileURL(
    createRequire(import.meta.url).resolve(
      "@lakatos/core/schemas/envelope.schema.json",
    ),
  ),
  "envelope",
);
