#!/bin/sh
# A stand-in for `.lake/build/bin/tarski`, so the runner's spawn path runs
# without the evaluator. It obeys the first string literal in the document
# it is handed that begins `fake: `; every run test in the fake tree
# carries one, in a declaration the real evaluator ignores, and the runner
# e2e holds these exit codes and stderr lines to the real binary's.
#
#   fake: exit 0
#   fake: exit 1 <the stderr line>
#   fake: exit 3 unsupported: <kind>
#   fake: exit 2 <the stderr line>
#   fake: timeout
#
# No marker means exit 0, which is what the harness preludes alone do.
if [ "$#" -ne 2 ] || { [ "$1" != run ] && [ "$1" != exec ]; }; then
  echo "usage: fake-tarski run|exec <file.json>" >&2
  exit 2
fi
instruction=$(grep -o '"value":"fake: [^"]*"' "$2" | head -n 1 | sed 's/^"value":"fake: //; s/"$//')
[ -n "$instruction" ] || instruction="exit 0"
case "$instruction" in
  timeout)
    # Spin past any timeout the runner imposes; the kill is the arm under test.
    while :; do :; done
    ;;
  "exit "*)
    rest=${instruction#exit }
    code=${rest%% *}
    line=${rest#"$code"}
    line=${line# }
    [ -n "$line" ] && printf '%s\n' "$line" >&2
    exit "$code"
    ;;
  *)
    echo "fake-tarski: unknown instruction $instruction" >&2
    exit 2
    ;;
esac
