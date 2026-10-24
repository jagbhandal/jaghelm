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
# 1. npm's own report structure means findings, whatever words the advisory text has
#    ("over the network", "ECONNRESET" in a title). npm 10-12: a "# npm audit report"
#    heading and a "N <severity> severity vulnerabilit(y|ies)" summary line.
if printf '%s\n' "$out" | grep -Eq '^# npm audit report|^[0-9]+ (low|moderate|high|critical)( |.*)severity vulnerabilit|^found [0-9]+ vulnerabilit'; then
  echo "::error::ADVISORY: '$*' found high or critical vulnerabilities (listed above). main's image build runs the same audit and would fail. Fix with one dependency PR merged first; every open PR then goes green on re-run."
  exit 1
fi
# 2. No report: a registry or network error. Error codes on npm's own error/warn lines only.
if printf '%s\n' "$out" | grep -Eq '^npm (error|ERR!|warn) .*(audit endpoint returned an error|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ESOCKETTIMEDOUT|code E(NOTFOUND|AUDIT|CONNRESET|TIMEDOUT|AI_AGAIN)|fetch failed)'; then
  echo "::error::AUDIT NOT RUN: '$*' could not reach the npm registry. This is not an advisory. Re-run the job."
  exit 1
fi
# 3. Anything else.
echo "::error::AUDIT FAILED with exit code $rc and no recognised output: '$*'. Read the output above; re-run if it looks like a registry problem."
exit 1
