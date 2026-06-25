#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
for f in env.example fcm-service-account.json.example; do
  git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 \
    && echo "  ok tracked: $f" || { echo "  FAIL untracked: $f"; fail=1; }
done
# the scanner must NOT flag the .example (fake placeholder) -> exit 0
python3 scripts/secret-scan.py fcm-service-account.json.example \
  || { echo "FAIL: scanner flagged the .example template"; fail=1; }
[ "$fail" -eq 0 ] && echo "PASS: FCM template tracked + skipped by scanner"
exit "$fail"
