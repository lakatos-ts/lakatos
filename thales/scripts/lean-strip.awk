# Blank out a Lean file's comments and string-literal text, keeping line
# numbers and interpolated terms, so a check's pattern sees only code.
# Shared by check-boundary.sh and check-imports.sh.
BEGIN { depth = 0; instr = 0; interp = 0 }
{
  line = $0; n = length(line); out = ""; i = 1
  while (i <= n) {
    c = substr(line, i, 1); two = substr(line, i, 2)
    if (interp > 0) {
      if (c == "{") interp++
      else if (c == "}") interp--
      out = out c; i++; continue
    }
    if (instr) {
      if (c == "\\") { out = out "  "; i += 2; continue }
      if (c == "{") { interp = 1; out = out c; i++; continue }
      if (c == "\"") { instr = 0; out = out " "; i++; continue }
      out = out " "; i++; continue
    }
    if (depth > 0) {
      if (two == "/-") { depth++; out = out "  "; i += 2; continue }
      if (two == "-/") { depth--; out = out "  "; i += 2; continue }
      out = out " "; i++; continue
    }
    if (two == "/-") { depth++; out = out "  "; i += 2; continue }
    if (two == "--") { while (i <= n) { out = out " "; i++ }; continue }
    if (c == "\"") { instr = 1; out = out " "; i++; continue }
    out = out c; i++
  }
  print out
}
