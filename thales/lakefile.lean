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

-- The `thales` tool's own logic: the envelope, the verdict and model
-- channels, the join, and run directories.
lean_lib «Thales» where
  globs := #[.submodules `Thales, .one `Thales]

-- `thales [files-or-globs...]`, the Lean port of the TypeScript tool
-- (#619). It renders artifacts in process, so it needs the interpreter's
-- symbols the way `thales-emit` does.
lean_exe «thales» where
  root := `Thales.Main
  supportInterpreter := true

lean_exe «thales-emit» where
  root := `ThalesEmit.Main
  -- The renderer imports ThalesDsl at runtime and pretty-prints through
  -- interpreted parenthesizers, which needs the interpreter's symbols.
  supportInterpreter := true

lean_lib «ThalesDslTest» where
  globs := #[.submodules `Test]
