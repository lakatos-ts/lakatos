import { schemaValidator } from "./schema-validator.js";

/** Fail the current test if `value` does not match the envelope schema,
 * pabst's copy of the output contract in the umbrella's `spec/`. */
export const expectValidEnvelope = schemaValidator(
  new URL("../../schemas/envelope.schema.json", import.meta.url),
  "envelope",
);
