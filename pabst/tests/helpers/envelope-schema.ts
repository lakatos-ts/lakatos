import { schemaValidator } from "./schema-validator.js";

/** Fail the current test if `value` does not match the envelope schema,
 * the output contract in the repo's `spec/`. */
export const expectValidEnvelope = schemaValidator(
  new URL("../../../spec/envelope.schema.json", import.meta.url),
  "envelope",
);
