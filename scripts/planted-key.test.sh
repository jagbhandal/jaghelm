#!/usr/bin/env bash
# Regression: a planted GCP service-account key (SA JSON + bare PEM) must be caught
# by scripts/secret-scan.py.  No real secret is ever committed — both payloads are
# written to a mktemp directory OUTSIDE the worktree and deleted on exit via trap.
#
# RED proof:  point the scanner at an empty stub (always exits 0) → both FAIL: lines fire.
# GREEN:      the real scanner already carries PEM_PRIVATE_KEY + GCP_SERVICE_ACCOUNT_KEY
#             rules, so both planted files trigger exit 1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ── sanity: scanner must exist and be executable ────────────────────────────
test -x scripts/secret-scan.py || { echo "FAIL: scripts/secret-scan.py missing/not executable"; exit 1; }

# ── plant fake keys in a temp dir outside the repo ──────────────────────────
d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT

# (a) GCP service-account JSON — clearly fake PKCS#8 body
printf '{\n "type":"service_account",\n "private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvFAKEFAKEFAKE\\n-----END PRIVATE KEY-----\\n"\n}\n' \
  > "$d/sa.json"  # pragma: allowlist secret

# (b) Bare PKCS#8 PEM file — clearly fake
printf -- '-----BEGIN PRIVATE KEY-----\nMIIEvFAKEFAKEFAKEFAKE\n-----END PRIVATE KEY-----\n' \
  > "$d/key.pem"  # pragma: allowlist secret

# ── assert each planted file is CAUGHT (non-zero exit) ──────────────────────
fail=0

if python3 scripts/secret-scan.py "$d/sa.json"; then
  echo "FAIL: GCP SA JSON not caught (scanner exited 0)"; fail=1
fi

if python3 scripts/secret-scan.py "$d/key.pem"; then
  echo "FAIL: bare PEM not caught (scanner exited 0)"; fail=1
fi

# ── confirm no planted file leaked into the repo tree ───────────────────────
# (temp dir is outside repo, but belt-and-suspenders: assert git sees nothing new)
if git status --porcelain | grep -qE 'sa\.json|key\.pem'; then
  echo "FAIL: planted key file visible in git status"; fail=1
fi

[ "$fail" -eq 0 ] && echo "PASS: planted GCP SA JSON + bare PEM both flagged by scanner"
exit "$fail"
