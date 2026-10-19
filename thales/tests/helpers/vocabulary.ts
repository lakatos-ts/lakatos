import { readFileSync } from "node:fs";

/** The status vocabulary as the envelope schema states it: the output
 * contract both engines honor, so thales pins its Lean against this. */
const schema = JSON.parse(
  readFileSync(
    new URL("../../../spec/envelope.schema.json", import.meta.url),
    "utf8",
  ),
) as {
  definitions: {
    annotation: {
      oneOf: { properties: { szs: { const?: string; enum?: string[] } } }[];
    };
    model: { oneOf: { properties: { status: { const: string } } }[] };
  };
};

const SZS = new Set(
  schema.definitions.annotation.oneOf.flatMap(({ properties: { szs } }) =>
    szs.const !== undefined ? [szs.const] : szs.enum!,
  ),
);

/** Statuses the CLI synthesizes and no prover verdict carries. */
const CLI_ONLY = ["InputError", "User"];

export const PROVE_STATUSES: ReadonlySet<string> = new Set(
  [...SZS].filter((s) => !CLI_ONLY.includes(s)),
);

export const MODEL_STATUSES: ReadonlySet<string> = new Set(
  schema.definitions.model.oneOf.map((b) => b.properties.status.const),
);
