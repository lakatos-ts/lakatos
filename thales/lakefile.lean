import Lake
open Lake DSL

package «thales» where
  leanOptions := #[
    ⟨`pp.unicode.fun, true⟩,
    ⟨`autoImplicit, false⟩
  ]

-- A path dependency: lake builds it in place, so nothing lands under .lake/packages.
require tarski from "../tarski"

@[default_target]
lean_lib «ThalesDsl» where
  globs := #[.submodules `ThalesDsl, .one `ThalesDsl]

lean_lib «ThalesEmit» where
  globs := #[.submodules `ThalesEmit, .one `ThalesEmit]

lean_lib «ThalesDslTest» where
  globs := #[.submodules `Test]

/-- The tool: admission, run directory, rendering, the Lean runs, the
join, and the envelope, around `ThalesDsl` and `ThalesEmit`. -/
lean_lib «Thales» where
  globs := #[.submodules `Thales]

/-- `thales [files-or-globs...]`. Rendering pretty-prints through
interpreted parenthesizers, which needs the interpreter's symbols. -/
lean_exe «thales» where
  root := `Thales.Main
  supportInterpreter := true
