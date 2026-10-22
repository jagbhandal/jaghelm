#!/usr/bin/env bash
# JagHelm's production deploy: one implementation, run by two workflows.
#   .gitea/workflows/deploy.yml     on a push to main, deploys that commit once
#                                   its image exists (the fast path);
#   .gitea/workflows/reconcile.yml  every 5 minutes, deploys main's head when
#                                   vm-103 runs anything else (#534).
# Each workflow step runs one command:
#   pin        pin vm-103's SSH host key; fails closed without it (#211)
#   wait       deploy.yml: wait for this commit's image
#   decide     reconcile.yml: compare vm-103 with main's head
#   signature  verify the image's cosign signature (opt-in)
#   stage      pull the image and deliver compose.yaml (#207)
#   switch     retag :latest and recreate
#   verify     the health gate, revision included (#356)
#   rollback   on failure: put back the previous image and compose.yaml
#   hold       on failure: keep the reconcile from retrying the commit
#   prune      remove old images
#   decision   the reconcile's rule alone, for the tests
# `wait` or `decide` exports DEPLOY_SHA, the commit to deploy; without it, and
# once the stage finds main has moved past it (SUPERSEDED), the deploy steps do
# nothing. The runner has no checkout: each workflow reads this file at its own
# commit from the Gitea API, as the stage reads compose.yaml.
#
# Environment: VM103_SSH and STACK_DIR (the job); GITHUB_SHA, GITHUB_ENV and
# GITHUB_EVENT_NAME (the runner); JOB_TOKEN, SERVER_URL and REPOSITORY (the
# steps that read Gitea); VM103_HOST_KEY (pin); IMAGE_WAIT_SECONDS (wait);
# HEALTH_URL and IMAGE_STALE_SECONDS (decide); SSH_CMD and VM103_KNOWN_HOSTS
# (exported by pin). Tested by scripts/deploy-workflow.test.mjs, which runs the
# workflows' steps against fake docker, ssh and curl.
set -euo pipefail

REPO=ghcr.io/jagbhandal/jaghelm
BUILDS=https://github.com/jagbhandal/jaghelm/commit

fail() {
  echo "::error::$*"
  exit 1
}

# The deploy steps run only for a chosen commit that main has not moved past.
deploying() {
  [ -n "${DEPLOY_SHA:-}" ] && [ "${SUPERSEDED:-}" != 1 ]
}
skip_unless_deploying() {
  if ! deploying; then
    echo "    nothing to deploy in this run: skipped"
    exit 0
  fi
}

# Gitea's API with the job token. The token reaches curl as a config line on
# stdin, never on argv.
gitea_get() {
  printf 'header = "Authorization: token %s"\n' "${JOB_TOKEN}" \
    | curl -fsS --max-time 30 -K - "$@"
}
api() {
  printf '%s/api/v1/repos/%s' "${SERVER_URL%/}" "${REPOSITORY}"
}
# Main's branch record from Gitea; empty when it can't be read.
main_branch() {
  gitea_get "$(api)/branches/main" 2>/dev/null || true
}
head_sha_of() {
  printf '%s\n' "$1" | sed -n 's/.*"commit":{"id":"\([0-9a-f]\{40\}\)".*/\1/p'
}
head_time_of() {
  printf '%s\n' "$1" | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p'
}
revision_of() {
  printf '%s\n' "$1" | sed -n 's/.*"revision":"\([^"]*\)".*/\1/p' | head -n 1
}

superseded() {
  echo ">>> Superseded by ${1:0:7}: main has moved on, and its deploy or the reconcile ships it. Nothing changed on vm-103."
}

# Seconds since the epoch of an ISO 8601 time as Gitea writes it
# (2026-10-22T17:21:44Z, or with an offset such as -04:00), in plain bash: the
# runner image's busybox date can't parse it. Fails on anything else.
iso_epoch() {
  local re='^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?(Z|([+-])([0-9]{2}):?([0-9]{2}))$'
  [[ $1 =~ $re ]] || return 1
  local y=$((10#${BASH_REMATCH[1]})) m=$((10#${BASH_REMATCH[2]})) d=$((10#${BASH_REMATCH[3]}))
  local secs=$((10#${BASH_REMATCH[4]} * 3600 + 10#${BASH_REMATCH[5]} * 60 + 10#${BASH_REMATCH[6]}))
  local off=0
  if [ "${BASH_REMATCH[8]}" != Z ]; then
    off=$(((10#${BASH_REMATCH[10]} * 60 + 10#${BASH_REMATCH[11]}) * 60))
    if [ "${BASH_REMATCH[9]}" = - ]; then off=$((-off)); fi
  fi
  # Days since 1970-01-01 (Howard Hinnant's days_from_civil; years here are > 0).
  if [ "$m" -le 2 ]; then y=$((y - 1)); fi
  local era=$((y / 400))
  local yoe=$((y - era * 400))
  local doy=$(((153 * ((m + 9) % 12) + 2) / 5 + d - 1))
  local doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
  echo $(((era * 146097 + doe - 719468) * 86400 + secs - off))
}

# ── pin ─────────────────────────────────────────────────────────────────────
# Every later SSH verifies vm-103's host key against VM103_HOST_KEY
# (StrictHostKeyChecking=yes, no global known_hosts), so whatever answers on
# vm-103's address is refused unless it holds that key. Runs before anything
# reaches vm-103, so a missing or malformed variable fails first.
cmd_pin() {
  local host key fp hosts
  host="${VM103_SSH#*@}"
  # A pasted trailing newline or CR is fine; anything else must be one line.
  key="$(printf '%s' "${VM103_HOST_KEY:-}" | tr -d '\r')"
  [ -n "${key}" ] || fail "VM103_HOST_KEY is not set. Set the repository variable to vm-103's known_hosts line (ssh-keyscan -t ed25519 ${host}, fingerprint checked on vm-103). Refusing to deploy without a pinned host key."
  [ "$(printf '%s\n' "${key}" | wc -l | tr -d ' ')" = 1 ] || fail "VM103_HOST_KEY must be a single known_hosts line."
  printf '%s\n' "${key}" \
    | grep -Eq '^[^[:space:]#|@][^[:space:]]*[[:space:]]+(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa)[[:space:]]+AAAA[A-Za-z0-9+/]+={0,2}([[:space:]].*)?$' \
    || fail "VM103_HOST_KEY is not a known_hosts line (<host> <key type> <base64 key>, host not hashed)."
  hosts="$(printf '%s\n' "${key}" | awk '{print $1}')"
  case ",${hosts}," in
    *",${host},"*) ;;
    *) fail "VM103_HOST_KEY is a key for '${hosts}', but the deploy connects to ${host}." ;;
  esac
  KH="$(mktemp)"
  printf '%s\n' "${key}" > "${KH}"
  if command -v ssh-keygen >/dev/null 2>&1; then
    fp="$(ssh-keygen -lf "${KH}")" || { rm -f "${KH}"; fail "VM103_HOST_KEY does not hold a valid public key."; }
    echo "    pinned vm-103 host key: ${fp}"
  fi
  echo "VM103_KNOWN_HOSTS=${KH}" >> "$GITHUB_ENV"
  echo "SSH_CMD=ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KH} -o GlobalKnownHostsFile=/dev/null -i /root/.ssh/runner_deploy ${VM103_SSH}" >> "$GITHUB_ENV"
}

# ── wait (deploy.yml) ────────────────────────────────────────────────────────
# The image is built by GitHub (.github/workflows/build-push.yml), after the
# Gitea mirror pushes the commit, so this push-triggered run usually starts
# first. Each round, main moving past this commit ends the wait green as
# superseded: main's newer head ships it. The image appearing exports
# DEPLOY_SHA. No image within IMAGE_WAIT_SECONDS ends it green too: a late
# image is the reconcile's to ship, and a build that never comes is the
# reconcile's to fail (#534). Either way vm-103 is not touched. Never :latest.
cmd_wait() {
  local tag="sha-${GITHUB_SHA:0:7}" deadline head
  echo ">>> Waiting for ${REPO}:${tag} (built by GitHub's \"Build and Push Docker Image\")"
  deadline=$(($(date +%s) + ${IMAGE_WAIT_SECONDS:?}))
  while :; do
    head="$(head_sha_of "$(main_branch)")"
    if [ -n "${head}" ] && [ "${head}" != "${GITHUB_SHA}" ]; then
      superseded "${head}"
      return 0
    fi
    if docker manifest inspect "${REPO}:${tag}" >/dev/null 2>&1; then
      echo "    ${REPO}:${tag} is available"
      echo "DEPLOY_SHA=${GITHUB_SHA}" >> "$GITHUB_ENV"
      return 0
    fi
    if [ "$(date +%s)" -ge "${deadline}" ]; then
      echo ">>> Image not built yet; the reconcile ships it when it is. ${REPO}:${tag} did not appear within ${IMAGE_WAIT_SECONDS}s, so nothing changed on vm-103. Reconcile production deploys main's head once its image exists, and fails if there is none 30 minutes after the commit."
      return 0
    fi
    echo "    not yet available, retrying in 15s..."
    sleep 15
  done
}

# ── decide (reconcile.yml) ───────────────────────────────────────────────────
# reconcile_decision HEAD LIVE IMAGE AGE HELD STALE_AFTER prints the reconcile's
# decision. HEAD is main's head, LIVE the revision vm-103's /api/health reports
# (empty: no answer), IMAGE yes|no whether HEAD's :sha-<short> exists, AGE the
# seconds since HEAD's commit time, HELD yes when HEAD's deploy failed and this
# run may not retry it. cmd_decide reads only what a decision needs, passing "-"
# for the rest.
#   noop         vm-103 runs main's head
#   deploy       behind, and main's head has its image
#   held         behind, but main's head already failed a deploy
#   wait         behind, no image yet (under STALE_AFTER seconds)
#   stale        behind, still no image STALE_AFTER seconds after the commit
#   unreachable  /api/health didn't answer (a warning: Kuma pages on that)
reconcile_decision() {
  local head=$1 live=$2 image=$3 age=$4 held=$5 stale_after=$6
  if [ -z "${live}" ]; then
    echo unreachable
  elif [ "${live}" = "${head:0:7}" ]; then
    echo noop
  elif [ "${image}" = yes ]; then
    if [ "${held}" = yes ]; then echo held; else echo deploy; fi
  elif [ "${age}" -ge "${stale_after}" ]; then
    echo stale
  else
    echo wait
  fi
}

# Sets LIVE to the revision /api/health reports on vm-103: "unknown" when it
# answers without one, empty when it doesn't answer. Read over HTTP from the
# runner, so a run with nothing to do needs no SSH; over SSH only if that fails.
# Any HTTP status counts (no -f): a JagHelm answering 503 still says what runs.
read_live() {
  local body
  body="$(curl -sS --max-time 10 "${HEALTH_URL:?}" 2>/dev/null)" || body=""
  if [ -z "${body}" ]; then
    echo "::warning::could not read ${HEALTH_URL} from the runner; read it over SSH"
    body="$($SSH_CMD "curl -sS --max-time 10 http://localhost:3099/api/health" 2>/dev/null)" || body=""
  fi
  LIVE=""
  if [ -n "${body}" ]; then LIVE="$(revision_of "${body}")"; fi
  if [ -n "${body}" ] && [ -z "${LIVE}" ]; then LIVE=unknown; fi
  return 0
}

# Sets HELD to yes when vm-103's deploy-failed names this commit (its full sha,
# or a prefix of 7 or more characters, as the manual rollback writes it) and
# this is a scheduled run; a run started by hand (workflow_dispatch) retries it.
read_held() {
  local named
  HELD=no
  [ "${GITHUB_EVENT_NAME:-}" != workflow_dispatch ] || return 0
  named="$($SSH_CMD "cat '${STACK_DIR}/deploy-failed' 2>/dev/null || true")" \
    || fail "could not reach vm-103 over SSH to read ${STACK_DIR}/deploy-failed; nothing changed."
  named="$(printf '%s\n' "${named}" | head -n 1 | cut -d' ' -f1)"
  if [ "${#named}" -ge 7 ]; then
    case "$1" in "${named}"*) HELD=yes ;; esac
  fi
}

cmd_decide() {
  local branch head short when epoch image=- age=- decision
  local stale="${IMAGE_STALE_SECONDS:?}"
  branch="$(main_branch)"
  head="$(head_sha_of "${branch}")"
  [ -n "${head}" ] || fail "could not read main's head from Gitea; nothing changed. The next run tries again."
  short="${head:0:7}"
  HELD=-
  read_live
  if [ -n "${LIVE}" ] && [ "${LIVE}" != "${short}" ]; then
    when="$(head_time_of "${branch}")"
    epoch="$(iso_epoch "${when}")" \
      || fail "could not read the commit time of main's head ${short} (\"${when}\"); nothing changed."
    age=$(($(date +%s) - epoch))
    if docker manifest inspect "${REPO}:sha-${short}" >/dev/null 2>&1; then
      image=yes
      read_held "${head}"
    else
      image=no
    fi
  fi
  decision="$(reconcile_decision "${head}" "${LIVE}" "${image}" "${age}" "${HELD}" "${stale}")"
  case "${decision}" in
    noop)
      echo ">>> vm-103 runs main's head ${short}: nothing to do." ;;
    deploy)
      echo ">>> vm-103 runs ${LIVE}, main's head is ${short} and its image exists: deploying ${short}."
      echo "DEPLOY_SHA=${head}" >> "$GITHUB_ENV" ;;
    held)
      echo "::warning::main's head ${short} failed its deploy on vm-103 (${STACK_DIR}/deploy-failed names it), so scheduled runs don't retry it; vm-103 runs ${LIVE}. Merge a fix, or run Reconcile production by hand to retry ${short}." ;;
    wait)
      echo ">>> main's head ${short} has no image yet, $((age / 60)) min after its commit; vm-103 runs ${LIVE}. Waiting for its build (this fails if there is none $((stale / 60)) min after the commit). Nothing changed." ;;
    stale)
      fail "main's head ${short} has no image $((age / 60)) min after its commit: its build failed or never ran. Check GitHub's \"Build and Push Docker Image\" run for it (${BUILDS}/${head}/checks; no checks there means the mirror never pushed it), then re-run or fix the build: the next run deploys it once ${REPO}:sha-${short} exists. vm-103 still runs ${LIVE}; nothing changed." ;;
    unreachable)
      # Uptime Kuma pages when JagHelm is down; redeploying blind could mask why.
      echo "::warning::could not read /api/health on vm-103 (${HEALTH_URL}, nor over SSH): JagHelm is not answering, so the reconcile can't tell what runs and leaves it alone. Nothing changed; the next run looks again." ;;
  esac
}

# ── signature (opt-in) ───────────────────────────────────────────────────────
# Verifies the image's cosign signature (the build signs by digest). The
# workflows run it only with the repository variable COSIGN_VERIFY=true.
cmd_signature() {
  skip_unless_deploying
  cosign verify "${REPO}:sha-${DEPLOY_SHA:0:7}" \
    --certificate-identity-regexp 'https://github.com/jagbhandal/jaghelm/.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
}

# ── stage: DEPLOY_SHA's image and compose.yaml (#207) ────────────────────────
# Nothing here changes what runs: the image is pulled but :latest is not moved,
# and the container is not touched.
#
# The deploy owns compose.yaml in the stack dir. The commit's copy is fetched
# from Gitea and written next to the live one as compose.yaml.new; on vm-103 its
# sha256 must equal the one fetched, the live copy is kept as compose.yaml.prev,
# the new one is renamed into place (atomic), and `docker compose config` must
# accept it and run only the :latest image that the switch retags. Any failure
# puts the previous copy back and fails the deploy before the container is
# touched. The log shows the repo hash, the host hash before and after, and a
# diff of the host copy, so a hand edit this replaces is on record. compose.yaml
# holds no secrets: they are in .env, which this never reads or prints.
# Host-specific additions go in compose.override.yaml, which compose merges and
# the deploy never touches.
#
# First, before anything reaches vm-103: if main's head is no longer this
# commit, stop green as superseded (#356); going on would put an older build
# over a newer one. DEPLOY_STARTED, set once the image is pulled, tells the
# hold step this deploy got as far as vm-103's config and container: a pull
# that fails (a GHCR blip) holds nothing back, and the next run retries it.
#
# Two refusals, both before the container is touched:
#   • the commit's image cannot be pulled (#356: no fallback to :latest);
#   • a merged config that drops host networking or a mount the running
#     container has. Such a drop deploys "healthy" while, say, push stops
#     because the FCM key mount is gone. For a deliberate drop, create
#     compose.accept-drops in the stack dir: the deploy logs what it drops and
#     removes the file after the health gate passes.
cmd_stage() {
  if [ -z "${DEPLOY_SHA:-}" ]; then
    echo "    nothing to deploy in this run: skipped"
    exit 0
  fi
  local tag="sha-${DEPLOY_SHA:0:7}" head compose_sha256 prev_image
  echo ">>> Checking ${DEPLOY_SHA} is still main's head"
  head="$(head_sha_of "$(main_branch)")"
  [ -n "${head}" ] || fail "could not read main's head commit from Gitea; nothing changed. Re-run this deploy."
  if [ "${head}" != "${DEPLOY_SHA}" ]; then
    superseded "${head}"
    echo "SUPERSEDED=1" >> "$GITHUB_ENV"
    exit 0
  fi

  echo ">>> Fetching compose.yaml at ${DEPLOY_SHA}"
  # Global, not local: the EXIT trap runs after this function has returned.
  CF="$(mktemp)"
  trap 'rm -f "${CF}"' EXIT
  gitea_get -o "${CF}" "$(api)/raw/compose.yaml?ref=${DEPLOY_SHA}"
  [ -s "${CF}" ] || fail "compose.yaml fetched for ${DEPLOY_SHA} is empty"
  compose_sha256="$(sha256sum "${CF}" | cut -d' ' -f1)"
  echo "    repo compose.yaml sha256=${compose_sha256} (commit ${DEPLOY_SHA})"

  # Record the image currently running so we can roll back to it if the new
  # one fails its health gate. Empty string if nothing is running yet. Must be
  # the image ID ({{.Image}}), not the name ({{.Config.Image}}): the name is
  # always ":latest", which the retag re-points at the NEW image, so "rolling
  # back" to it would just restart the bad deploy.
  echo ">>> Recording current image for rollback"
  prev_image="$($SSH_CMD "docker inspect --format '{{.Image}}' jaghelm 2>/dev/null || true")"
  echo "    previous image: ${prev_image:-<none>}"
  echo "PREV_IMAGE=${prev_image}" >> "$GITHUB_ENV"

  echo ">>> Pulling ${REPO}:${tag} (this commit's image)"
  if ! $SSH_CMD "docker pull '${REPO}:${tag}'"; then
    fail "vm-103 could not pull ${REPO}:${tag}; nothing changed (the running container and compose.yaml are untouched). Re-run this deploy; if the pull keeps failing, check GHCR from vm-103."
  fi
  echo "DEPLOY_STARTED=1" >> "$GITHUB_ENV"

  echo ">>> Delivering compose.yaml to ${STACK_DIR}"
  $SSH_CMD "cat > '${STACK_DIR}/compose.yaml.new'" < "${CF}"
  $SSH_CMD "bash -s -- '${STACK_DIR}' '${compose_sha256}'" <<'INSTALL_COMPOSE'
set -euo pipefail
dir=$1 want=$2
cd "$dir"
sha() { sha256sum "$1" | cut -d' ' -f1; }
had_prev=0 installed=0 done=0
# On any failure after the rename, put the previous copy back (copy, then
# rename, so compose.yaml is never half-written).
finish() {
  rc=$?
  rm -f compose.yaml.new
  if [ "$done" != 1 ] && [ "$installed" = 1 ]; then
    if [ "$had_prev" = 0 ]; then
      rm -f compose.yaml && echo "    removed the new compose.yaml (there was none before)"
    elif cp -p compose.yaml.prev compose.yaml.restore && mv -f compose.yaml.restore compose.yaml; then
      echo "    restored the previous compose.yaml (sha256=$(sha compose.yaml))"
    else
      echo "::error::could not restore compose.yaml; copy compose.yaml.prev back by hand"
    fi
  fi
  [ "$done" = 1 ] || [ "$rc" -ne 0 ] || rc=1
  exit "$rc"
}
trap finish EXIT

got=$(sha compose.yaml.new)
if [ "$got" != "$want" ]; then
  echo "::error::compose.yaml.new on vm-103 has sha256=$got, expected $want; nothing changed"
  exit 1
fi
old=none
if [ -f compose.yaml ]; then old=$(sha compose.yaml); fi
if [ -f compose.yaml ]; then
  had_prev=1
  echo "    host compose.yaml before: sha256=$old"
  if [ "$old" = "$want" ]; then
    echo "    unchanged"
  else
    diff -u --label 'compose.yaml (host, before)' --label 'compose.yaml (this commit)' \
      compose.yaml compose.yaml.new || true
  fi
  cp -p compose.yaml compose.yaml.prev
else
  echo "    host compose.yaml before: none"
  rm -f compose.yaml.prev
fi
if [ -f compose.override.yaml ]; then
  echo "    compose.override.yaml (host-owned, not changed): sha256=$(sha compose.override.yaml)"
fi

mv -f compose.yaml.new compose.yaml
installed=1
# Only -q and --images: a plain `docker compose config` prints .env values.
docker compose config -q </dev/null \
  || { echo "::error::docker compose config rejected the new compose.yaml"; exit 1; }
images=$(docker compose config --images </dev/null)
if [ "$images" != "ghcr.io/jagbhandal/jaghelm:latest" ]; then
  echo "::error::compose must run only ghcr.io/jagbhandal/jaghelm:latest (the deploy pins by retagging it), got: $images"
  exit 1
fi

# Drop guard: keep the running container's host networking and mounts.
cur_net=$(docker inspect -f '{{.HostConfig.NetworkMode}}' jaghelm </dev/null 2>/dev/null || true)
if [ -z "$cur_net" ]; then
  echo "    no jaghelm container: drop check skipped"
else
  cur_mounts=$(docker inspect -f '{{range .Mounts}}{{println .Destination}}{{end}}' jaghelm </dev/null)
  # The merged config without env resolution or interpolation (so no .env
  # values in it), reduced by python3 to the network mode and the mount
  # targets. Never printed. An unsupported flag fails closed.
  new_cfg=$(docker compose config --format json --no-interpolate --no-env-resolution </dev/null \
    | python3 -c 'import json, sys; s = json.load(sys.stdin)["services"]["jaghelm"]; t = s.get("tmpfs") or []; print("\n".join(
        [s.get("network_mode") or "default"]
        + [v["target"] for v in s.get("volumes") or []]
        + [p.split(":")[0] for p in ([t] if isinstance(t, str) else t)]))')
  new_net=${new_cfg%%$'\n'*}
  new_targets=$'\n'$(printf '%s\n' "$new_cfg" | tail -n +2)$'\n'
  drops=""
  if [ "$cur_net" = host ] && [ "$new_net" != host ]; then
    drops="network_mode host (would become $new_net)"
  fi
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    case "$new_targets" in
      *$'\n'"$d"$'\n'*) ;;
      *) drops="${drops:+$drops; }mount $d" ;;
    esac
  done <<<"$cur_mounts"
  if [ -z "$drops" ]; then
    echo "    drop check: keeps the running container's network mode and mounts"
  elif [ -e compose.accept-drops ]; then
    echo "    compose.accept-drops present, dropping: $drops"
  else
    echo "::error::the new config drops what the running jaghelm container has: $drops. Keep it via compose.override.yaml, or if the drop is intended create $dir/compose.accept-drops and re-run (removed after a healthy deploy)."
    exit 1
  fi
fi
now=$(sha compose.yaml)
if [ "$now" != "$want" ]; then
  echo "::error::host compose.yaml has sha256=$now, expected $want"
  exit 1
fi
echo "    host compose.yaml after: sha256=$now (matches the commit)"
done=1
INSTALL_COMPOSE
  echo "COMPOSE_SHA256=${compose_sha256}" >> "$GITHUB_ENV"
  # Last: vm-103 is changed from here on, so the rollback acts only once this ran.
  echo "ROLLBACK_ARMED=1" >> "$GITHUB_ENV"
}

# ── switch: recreate with DEPLOY_SHA's image and compose.yaml ────────────────
cmd_switch() {
  skip_unless_deploying
  local tag="sha-${DEPLOY_SHA:0:7}" host_sha256
  # Recreate only with the compose.yaml delivered for this commit.
  host_sha256="$($SSH_CMD "sha256sum '${STACK_DIR}/compose.yaml'" | cut -d' ' -f1)"
  echo "    host compose.yaml sha256=${host_sha256}"
  if [ "${host_sha256}" != "${COMPOSE_SHA256:-}" ]; then
    fail "host compose.yaml no longer matches commit ${DEPLOY_SHA} (expected sha256=${COMPOSE_SHA256:-?})"
  fi

  # Deploy THIS commit's immutable image: retag the :sha-<short> pulled in the
  # stage as :latest locally, so compose (which references :latest) runs
  # exactly what this commit built, not whatever :latest races to.
  $SSH_CMD "docker tag '${REPO}:${tag}' '${REPO}:latest'"
  echo "    pinned :latest -> ${tag}"

  echo ">>> Deploying"
  $SSH_CMD "cd '${STACK_DIR}' && docker compose up -d --force-recreate"
}

# ── verify: the health gate ──────────────────────────────────────────────────
# Asserts that:
#   1. the container reports Health.Status == healthy (Docker HEALTHCHECK),
#   2. /api/health returns HTTP 200 AND a body containing "status":"ok",
#   3. /api/health's "revision" is this commit's short sha (#356), so a green
#      deploy always means this commit is the one serving.
# On failure it exits non-zero; the rollback step then restores the previous
# release. On success it removes compose.accept-drops (it covers one deploy)
# and deploy-failed (main's head is live).
cmd_verify() {
  skip_unless_deploying
  local short="${DEPLOY_SHA:0:7}" health_ok=0 endpoint_ok=0 revision_ok=0 deadline status body revision
  echo ">>> Polling container health (timeout 120s)"
  # Healthy passes; unhealthy or the timeout fails; starting keeps polling.
  deadline=$(($(date +%s) + 120))
  while [ "$(date +%s)" -lt "${deadline}" ]; do
    status="$($SSH_CMD "docker inspect --format '{{.State.Health.Status}}' jaghelm 2>/dev/null || echo missing")"
    echo "    health=${status}"
    if [ "${status}" = "healthy" ]; then
      health_ok=1
      break
    fi
    if [ "${status}" = "unhealthy" ]; then
      echo "    container reported unhealthy"
      break
    fi
    sleep 5
  done

  # The health endpoint, independently of the HEALTHCHECK: -f fails on HTTP
  # >=400, and the body must be ok and name this commit's revision.
  echo ">>> Asserting /api/health returns status:ok and revision ${short}"
  body="$($SSH_CMD "curl -fsS --max-time 10 http://localhost:3099/api/health" || true)"
  case "${body}" in *'"status":"ok"'*) endpoint_ok=1 ;; esac
  revision="$(revision_of "${body}")"
  if [ "${revision}" = "${short}" ]; then
    revision_ok=1
  elif [ -n "${body}" ]; then
    echo "::error::/api/health on vm-103 reports revision ${revision:-<none>}, not this commit (${short}): the container runs another build. Failing the deploy."
  fi
  echo "    endpoint_ok=${endpoint_ok} health_ok=${health_ok} revision=${revision:-<none>}"

  if [ "${health_ok}" -eq 1 ] && [ "${endpoint_ok}" -eq 1 ] && [ "${revision_ok}" -eq 1 ]; then
    echo ">>> Deploy verified healthy (commit ${DEPLOY_SHA}, revision ${short} live, compose.yaml sha256=${COMPOSE_SHA256:-?})."
    $SSH_CMD "cd '${STACK_DIR}' && for f in compose.accept-drops deploy-failed; do if [ -e \"\$f\" ]; then rm -f \"\$f\" && echo \"    removed \$f\"; fi; done" \
      || echo "::error::could not remove compose.accept-drops or deploy-failed in ${STACK_DIR}; remove them by hand, or the next deploy may drop mounts too"
    exit 0
  fi

  echo "!!! Deploy failed health gate."
  exit 1
}

# ── rollback (on failure) ────────────────────────────────────────────────────
# Acts only if the stage completed (ROLLBACK_ARMED): before that, vm-103 was
# not changed. It puts back the pair that was running before this deploy:
# compose.yaml.prev (the file the previous container was created from) and the
# previous image ID, retagged as :latest, then recreates. Restoring the compose
# file matters: a compose change (mounts, env, read-only rootfs, limits) may not
# suit the old image. The file is swapped whole (copy, then rename), never
# edited. It acts only while vm-103 runs this run's image or the one from before
# it (or none): if an overlapping, later deploy has replaced it since,
# restoring would undo that deploy, so it leaves vm-103 alone (#356).
cmd_rollback() {
  if [ "${ROLLBACK_ARMED:-}" != 1 ]; then
    echo ">>> The deploy failed before vm-103 was changed; nothing to roll back."
    exit 0
  fi
  if [ -z "${PREV_IMAGE:-}" ]; then
    echo ">>> No previous image recorded — cannot auto-rollback. Manual intervention required."
    exit 1
  fi
  local tag="sha-${DEPLOY_SHA:0:7}" rc=0
  echo ">>> Rolling back to the previous image ${PREV_IMAGE} and its compose.yaml"
  $SSH_CMD "bash -s -- '${STACK_DIR}' '${PREV_IMAGE}' '${REPO}:${tag}'" <<'ROLLBACK' || rc=$?
set -euo pipefail
dir=$1 prev_image=$2 this_image=$3
cd "$dir"
running=$(docker inspect --format '{{.Image}}' jaghelm </dev/null 2>/dev/null || true)
mine=$(docker image inspect --format '{{.Id}}' "$this_image" </dev/null 2>/dev/null || true)
if [ -n "$running" ] && [ "$running" != "$prev_image" ] && [ "$running" != "$mine" ]; then
  echo "    vm-103 runs $running, neither this run's image nor the one before it: a later deploy replaced it, so nothing restored."
  exit 10
fi
if [ -f compose.yaml.prev ]; then
  cp -p compose.yaml.prev compose.yaml.restore
  mv -f compose.yaml.restore compose.yaml
  echo "    restored compose.yaml (sha256=$(sha256sum compose.yaml | cut -d' ' -f1))"
else
  echo "    no compose.yaml.prev (there was no compose.yaml before this deploy)"
fi
docker tag "$prev_image" ghcr.io/jagbhandal/jaghelm:latest </dev/null
docker compose up -d --force-recreate </dev/null
ROLLBACK
  if [ "${rc}" -eq 0 ]; then
    echo ">>> Rollback applied — verify the service manually."
  elif [ "${rc}" -eq 10 ]; then
    echo ">>> Rollback skipped: a later deploy is live."
  else
    echo ">>> Rollback command FAILED — manual intervention required."
    exit 1
  fi
}

# ── hold (on failure) ────────────────────────────────────────────────────────
# A deploy that failed after its image was pulled (compose.yaml refused, the
# switch, the health gate) writes its commit to deploy-failed in the stack
# dir. Scheduled reconcile runs don't retry that commit, so a bad build is
# tried once, not every 5 minutes with a restart each time. A healthy deploy
# removes the file; a reconcile run started by hand retries the commit. The
# manual rollback in docs/RELEASING.md writes the file too, by hand.
cmd_hold() {
  if [ "${DEPLOY_STARTED:-}" != 1 ]; then
    echo ">>> The deploy failed before its image was on vm-103; nothing to hold back."
    exit 0
  fi
  if $SSH_CMD "printf '%s %s\n' '${DEPLOY_SHA}' '$(date -u +%Y-%m-%dT%H:%M:%SZ)' > '${STACK_DIR}/deploy-failed'"; then
    echo ">>> ${STACK_DIR}/deploy-failed names ${DEPLOY_SHA:0:7}: scheduled reconcile runs won't retry ${DEPLOY_SHA:0:7}. Merge a fix, or once the cause is fixed re-run this deploy or run Reconcile production by hand."
  else
    echo "::warning::could not write ${STACK_DIR}/deploy-failed; the reconcile may retry ${DEPLOY_SHA:0:7} on its next run"
  fi
}

# ── prune ────────────────────────────────────────────────────────────────────
# Every deploy pulls a new :sha-<short> image and nothing removed the old ones
# (~35 had piled up on vm-103). Runs only after the health gate passes (a
# failed deploy keeps everything for the rollback). Keeps the KEEP newest
# :sha-* tags plus whatever image the container is running, then clears the
# untagged leftovers. Best-effort: the workflows never fail on it.
cmd_prune() {
  skip_unless_deploying
  $SSH_CMD "KEEP=3 bash -s" <<'PRUNE'
set -euo pipefail
REPO=ghcr.io/jagbhandal/jaghelm
RUNNING="$(docker inspect --format '{{.Image}}' jaghelm)"
# `docker images` lists newest first, so everything past KEEP is old.
docker images "$REPO" --format '{{.Tag}}' \
  | { grep '^sha-' || true; } \
  | tail -n +$((KEEP + 1)) \
  | while read -r TAG; do
      if [ "$(docker image inspect --format '{{.Id}}' "$REPO:$TAG")" = "$RUNNING" ]; then
        continue
      fi
      docker rmi "$REPO:$TAG" >/dev/null && echo "    removed $REPO:$TAG"
    done
docker image prune -f
PRUNE
}

case "${1:-}" in
  pin) cmd_pin ;;
  wait) cmd_wait ;;
  decide) cmd_decide ;;
  signature) cmd_signature ;;
  stage) cmd_stage ;;
  switch) cmd_switch ;;
  verify) cmd_verify ;;
  rollback) cmd_rollback ;;
  hold) cmd_hold ;;
  prune) cmd_prune ;;
  decision) shift; reconcile_decision "$@" ;;
  *) fail "usage: deploy.sh pin|wait|decide|signature|stage|switch|verify|rollback|hold|prune" ;;
esac
