# @lakatos-ts/core

What every lakatos-ts tool shares at runtime, and nothing else: no
annotation language, no engine.

- `envelope` — the result of one run: annotation identities, per-annotation
  results with their SZS status, the model field, and the envelope itself.
  `schemas/envelope.schema.json` is the same contract as JSON Schema.
- `szs` — the status vocabulary (a subset of the
  [SZS ontology](https://tptp.org/UserDocs/SZSOntology/)), the prove
  subset, and the refuter's issue kinds.
- `interrupt` — which signals a run still reports on, and the guard that
  lets a tool report before it dies of one.
- `run-dir` — claiming a timestamped directory under `.lakatos/` for a
  run's artifacts.

Import by subpath: `@lakatos-ts/core/envelope`, `/szs`, `/interrupt`,
`/run-dir`.
