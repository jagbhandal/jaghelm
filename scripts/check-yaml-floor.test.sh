#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
wf=".gitea/workflows/check.yml"
fail=0
python3 -c "import yaml,sys; yaml.safe_load(open('$wf'))" || { echo "FAIL: $wf not valid YAML"; fail=1; }
grep -q "secret-scan.py" "$wf" || { echo "FAIL: no secret-scan step in $wf"; fail=1; }
grep -q "git ls-files --error-unmatch" "$wf" || { echo "FAIL: no template-tracked assert in $wf"; fail=1; }
grep -q "fcm-service-account.json.example" "$wf" || { echo "FAIL: FCM template not asserted in $wf"; fail=1; }
# run the actual assertion logic locally to prove it passes on this tree
bash scripts/template-tracked.test.sh >/dev/null || { echo "FAIL: template-tracked logic fails locally"; fail=1; }
[ "$fail" -eq 0 ] && echo "PASS: check.yml wires the floor gate"
exit "$fail"
