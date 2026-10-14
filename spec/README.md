# spec

The output contract every lakatos engine honors, independent of any one
implementation.

- [`envelope.schema.json`](envelope.schema.json) — the JSON envelope a
  pabst or thales run prints on stdout: one entry per scraped annotation,
  each with its [SZS](https://tptp.org/UserDocs/SZSOntology/) status. The
  root [README](../README.md#the-result-envelope) explains the fields.

Each engine validates its own output against these files in its tests.
