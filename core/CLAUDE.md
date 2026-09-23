# CLAUDE.md

`@lakatos-ts/core`: what every lakatos-ts tool shares at runtime. Charter: no language code, no engine code, no in-repo dependency. A new module belongs here only if every tool's bin needs it.

Modules are subpath exports (`envelope`, `szs`, `interrupt`, `run-dir`); add a new one to `package.json`'s `exports` and to the alias in the root `vitest.config.ts`. `schemas/envelope.schema.json` ships with the package and `tests/envelope-schema.test.ts` pins it against the TypeScript types.

Build, typecheck, test, and format from the repo root. This package is a composite `tsc` project the root references, so `npm run build` at the root emits `dist/` here first; removing `dist/` also removes the build state, so a clean rebuild is `rm -rf dist core/dist`.
