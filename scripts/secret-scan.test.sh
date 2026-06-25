#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
test -x scripts/secret-scan.py || { echo "FAIL: scripts/secret-scan.py missing/not executable"; exit 1; }
# planted GCP service-account key in a tmp file MUST be caught (exit 1)
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
printf '{\n  "type":"service_account",\n  "private_key":"-----BEGIN PRIVATE KEY-----\nMIIEvFAKE\n-----END PRIVATE KEY-----\n"\n}\n' > "$tmp" # pragma: allowlist secret
if python3 scripts/secret-scan.py "$tmp"; then echo "FAIL: scanner did not flag a GCP SA key"; exit 1; fi
echo "PASS: secret-scan present + catches GCP SA key"
