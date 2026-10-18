#!/usr/bin/env bash
# Every job in deploy.yml SSHes to vm-103, so each must carry the vm103 runner label
# and never land on a runner that is fenced from the LAN.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
wf=".gitea/workflows/deploy.yml"
python3 - "$wf" <<'PY' || { echo "FAIL: a job in $wf is not pinned to vm103"; exit 1; }
import sys, yaml
jobs = yaml.safe_load(open(sys.argv[1]))["jobs"]
assert jobs, "no jobs"
for jid, job in jobs.items():
    ro = job.get("runs-on")
    labels = [ro] if isinstance(ro, str) else list(ro or [])
    assert "vm103" in labels, f"{jid}: runs-on={ro!r}"
PY
echo "PASS: every job in $wf is pinned to vm103"
