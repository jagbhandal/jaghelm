#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
# real secrets MUST be ignored
for s in test.pem test.jks google-services.json acme-service-account.json keystore.properties; do
  git check-ignore -q "$s" || { echo "FAIL: $s is NOT ignored"; fail=1; }
done
# templates MUST NOT be ignored (negations win)
for t in env.example fcm-service-account.json.example .env.example; do
  if git check-ignore -q "$t"; then echo "FAIL: template $t IS ignored"; fail=1; fi
done
# the FCM template file must exist on disk
test -f fcm-service-account.json.example || { echo "FAIL: fcm-service-account.json.example missing"; fail=1; }
[ "$fail" -eq 0 ] && echo "PASS: gitignore floor correct"
exit "$fail"
