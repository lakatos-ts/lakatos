#!/bin/sh
# The import boundary.
#
# The semantics sits below the prover in this lake package: nothing under
# `Js/` or `Tarski/`, nor `Js.lean` or `Tarski.lean`, imports a module of
# `ThalesDsl`, `ThalesEmit`, or `Thales`. A lake `require` held that line
# while the two were separate packages; this check holds it now. A
# module's first component decides, so `ThalesDsl.Prove` is a hit and
# `ThalesDslX` is not, and comments are blanked first, so a doc comment
# quoting an import is not one.
#
# The optional argument is the package root to scan (default `.`), so CI
# can point the check at `scripts/import-fixture`, which plants a
# violation, and see it fail.
#
# Usage: sh scripts/check-imports.sh [package-root]
set -eu

here=$(dirname "$0")
root="${1:-.}"

pattern='^[[:space:]]*(public[[:space:]]+)?(meta[[:space:]]+)?import[[:space:]]+(all[[:space:]]+)?(Thales|ThalesDsl|ThalesEmit)([.[:space:]]|$)'

files=$(mktemp)
hits=$(mktemp)
trap 'rm -f "$files" "$hits"' EXIT

for f in "$root/Js.lean" "$root/Tarski.lean"; do
  if [ -f "$f" ]; then printf '%s\n' "$f" >>"$files"; fi
done
for d in "$root/Js" "$root/Tarski"; do
  if [ -d "$d" ]; then find "$d" -name '*.lean' >>"$files"; fi
done

scanned=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  scanned=$((scanned + 1))
  shown=${file#./}
  awk -f "$here/lean-strip.awk" "$file" | grep -nE "$pattern" |
    while IFS= read -r hit; do printf '%s:%s\n' "$shown" "$hit"; done >>"$hits" || true
done <<EOF
$(sort "$files")
EOF

violations=$(wc -l <"$hits" | tr -d ' ')
if [ "$violations" -ne 0 ]; then
  cat "$hits"
  echo "imports: $violations violation(s)"
  exit 1
fi

echo "imports: $scanned file(s) clean"
