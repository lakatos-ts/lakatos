import Lake
open Lake DSL

package «thales» where
  leanOptions := #[
    ⟨`pp.unicode.fun, true⟩,
    ⟨`autoImplicit, false⟩
  ]

/-- The JS semantics. Nothing under `Js/` or `Tarski/` imports the prover;
`scripts/check-imports.sh` holds that line in CI. -/
@[default_target]
lean_lib «Js» where
  globs := #[.submodules `Js, .one `Js]

@[default_target]
lean_lib «Tarski» where
  globs := #[.submodules `Tarski, .one `Tarski]

@[default_target]
lean_lib «ThalesDsl» where
  globs := #[.submodules `ThalesDsl, .one `ThalesDsl]

@[default_target]
lean_lib «ThalesEmit» where
  globs := #[.submodules `ThalesEmit, .one `ThalesEmit]

/-- The tool: admission, run directory, rendering, the Lean runs, the
join, and the envelope, around `ThalesDsl` and `ThalesEmit`. -/
@[default_target]
lean_lib «Thales» where
  globs := #[.submodules `Thales]

/-- The evaluator's binary: `tarski run <file.json>`. Nothing is
elaborated at runtime, so it needs no interpreter support. -/
@[default_target]
lean_exe «tarski» where
  root := `Tarski.Main

/-- `tarski-test262`: test262 against the evaluator, one `tarski run`
child per test, parsing through lemma. -/
@[default_target]
lean_exe «tarski-test262» where
  root := `Tarski.Test262.Main

/-- `thales [files-or-globs...]`. Rendering pretty-prints through
interpreted parenthesizers, which needs the interpreter's symbols. -/
@[default_target]
lean_exe «thales» where
  root := `Thales.Main
  supportInterpreter := true

/-- Every Lean test: the semantics' under `Test/Js/` and `Test/Tarski/`,
the prover's under `Test/Thales*/`. -/
lean_lib «Test» where
  globs := #[.submodules `Test]
