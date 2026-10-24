#!/bin/sh
# Push a host's drift check result to JagHelm (#674). Run from a timer or cron on
# the host that runs the check; the secret is JAGHELM_CRON_SECRET, kept in a file
# (chmod 600), never on the command line. Needs jq and curl.
H=pi-1; S=$(cat /etc/jaghelm/secret); OUT=$(python3 tools/ops/drift_check.py "$H"); RC=$?
jq -n --arg s "$S" --arg h "$H" --arg t "$(date -u +%FT%TZ)" --argjson rc "$RC" --arg out "$OUT" \
  '{secret:$s, host:$h, checkedAt:$t, status:(if $rc==0 then "ok" elif $rc==1 then "drift" else "error" end),
    items:[$out|split("\n")[]|capture("^\\S+\\s+(?<kind>DIFF|MISSING|UNREAD)\\s+(?<name>\\S+)\\s*(?<detail>.*)$")]}' |
  curl -fsS --max-time 20 -H 'Content-Type: application/json' -d @- https://jaghelm.example/api/drift/report
