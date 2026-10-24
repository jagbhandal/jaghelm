#!/usr/bin/env bash
# Runs a dependency-audit command (`npm audit --audit-level=high`) for the PR check
# (#616) and says WHY it failed. npm exits 1 both for findings and for a registry
# error, so the output is read to tell them apart. A timeout stops a hung registry
# from holding the runner.
#   usage: scripts/ci-audit.sh npm audit --audit-level=high
set -u
[ "$#" -gt 0 ] || { echo "usage: $0 <audit command...>" >&2; exit 2; }
LIMIT="${AUDIT_TIMEOUT:-180}"

out=$(timeout "$LIMIT" "$@" 2>&1)
rc=$?
printf '%s\n' "$out"

if [ "$rc" -eq 0 ]; then
  exit 0
fi
if [ "$rc" -eq 124 ]; then
  echo "::error::AUDIT NOT RUN: '$*' timed out after ${LIMIT}s (npm registry slow or unreachable). This is not an advisory. Re-run the job."
  exit 1
fi
if printf '%s' "$out" | grep -Eqi 'audit endpoint returned an error|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ESOCKETTIMEDOUT|fetch failed|network|getaddrinfo|E50[0-9]|E429|self[- ]signed'; then
  echo "::error::AUDIT NOT RUN: '$*' could not reach the npm registry. This is not an advisory. Re-run the job."
  exit 1
fi
if printf '%s' "$out" | grep -Eqi 'vulnerabilit'; then
  echo "::error::ADVISORY: '$*' found high or critical vulnerabilities (listed above). main's image build runs the same audit and would fail. Fix with one dependency PR merged first; every open PR then goes green on re-run."
  exit 1
fi
echo "::error::AUDIT FAILED with exit code $rc and no recognised output: '$*'. Read the output above; re-run if it looks like a registry problem."
exit 1
