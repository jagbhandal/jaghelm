#!/bin/sh
# Push a host's drift check result to JagHelm (#674). Run once per host from a
# timer or cron on the machine that runs the check: drift-push.sh pi-1
# The secret (JAGHELM_CRON_SECRET) is read from a file (chmod 600) by jq and
# reaches curl on stdin: it is never on a command line. Needs jq and curl.
# Do not run with set -x. DRIFT_CHECK is the ABSOLUTE path (cron has another cwd).
H=${1:?host}; DC=${DRIFT_CHECK:-/opt/homelab-infra/tools/ops/drift_check.py}
OUT=$(python3 "$DC" "$H"); RC=$?
jq -n --rawfile s "${SECRET_FILE:-/etc/jaghelm/secret}" --arg h "$H" --arg t "$(date -u +%FT%TZ)" --argjson rc "$RC" --arg out "$OUT" \
  '[$out|split("\n")[]|capture("^\\S+\\s+(?<kind>DIFF|MISSING|UNREAD)\\s+(?<name>.+?)(?:  (?<detail>\\(.*\\)))?$")
    |{name:.name[:256], kind, detail:((.detail // "")[:500])}][:200] as $i
   | {secret:($s|rtrimstr("\n")), host:$h, checkedAt:$t, items:$i,
      status:(if $rc==0 then "ok" elif ($rc==1 and ($i|length)>0) then "drift" else "error" end)}' |
  ${CURL:-curl} -fsS --max-time 20 -H 'Content-Type: application/json' --data @- "${DRIFT_URL:-https://jaghelm.example}/api/drift/report"
