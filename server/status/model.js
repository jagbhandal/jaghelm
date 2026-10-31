/**
 * The server status model (spec §6, #290): one place that judges every entity
 * JagHelm watches, so no client and no push path judges one for itself.
 *
 * buildStatus() is a pure, deterministic function of
 *
 *   - `inputs`: what this cycle's refreshes left (the cached /api/services,
 *     /api/ups and /api/integrations payloads, what the services refresh
 *     keeps beside its payload, the cron store's statuses), see readStatusInputs
 *     in ./index.js;
 *   - `thresholds`: the one server threshold config (./thresholds.js), the
 *     same values push reads;
 *   - `memory`: what the previous call returned as `memory` (null on the
 *     first), for hysteresis, "for 2 cycles" and each entity's `since`;
 *   - `now`: the cycle's clock, in ms since the epoch.
 *
 * It returns `{ status, memory }`. `status` is the model (docs/ARCHITECTURE.md
 * §4.7): `overall`, `issues`, `subsystems`, `entities`, `sources`, and
 * `thresholds`, the lines it judged by, as given (#451): a screen draws a
 * meter's line from them (status/readings.js), never from a copy of its own.
 * They change only when the config does, so a steady board's status, and its
 * ETag, hold from cycle to cycle. `memory` is for the next call only and is
 * never served.
 *
 * Failed sources (#232): a source that failed this cycle makes the entities it
 * feeds `unknown`, with a reason naming it, never `crit`. An entity it fed last
 * cycle that is missing now (Prometheus failing drops the container list, a
 * node, the UPS) is kept, as `unknown`, until the source answers again. The
 * failed source is itself one `warn` issue.
 *
 * Drives (docs/superpowers/specs/2026-10-29-drive-health-design.md): an
 * optional input, `inputs.drives` (drives.js, cached by the loop). Each drive
 * is a condition of its node (status/drives.js); a node that had drives and
 * can no longer see them is not amber for it but a source of its own,
 * `drives-source:<node>`, in the unknown state. With no drive input the model
 * is what it was before drives. Why it failed is said in words
 * (failureWords.js, #605), one sentence per cause, never the upstream's or
 * the fetch's text.
 */
import {
  NOT_SCRAPED,
  errorText,
  judgeAgent,
  judgeContainer,
  judgeIntegration,
  judgeJob,
  judgeNode,
  judgeService,
  judgeUps,
} from './rules.js';
import { temperatureUnits } from './readings.js';
import { isOverdue } from '../cron-overdue.js';
import { NO_ANSWER, failureSentence } from '../failureWords.js';
import { scheduleWords } from './schedule.js';
import { SUBSYSTEMS, summarize } from './summary.js';
import { withStacks } from './stacks.js';
import { UP_MISSING } from './upMissing.js';
import { containerConditionIssues } from './containerConditions.js';
import { blindReason, DRIVES_SOURCE } from './drives.js';
import { CONTAINERS_SOURCE, containerBlindName, containerBlindNodes, containerBlindReason } from './containerBlind.js';

// The sources whose failure is an issue (spec §6.1), and their names: the
// monitoring sources, and services.yaml (#505), listed only while it is no
// usable config. Any source whose URL is refused (#419) is one too, Gitea
// included.
const MONITORING_SOURCES = ['prometheus', 'kuma', 'nut', 'config'];
const SOURCE_NAMES = {
  prometheus: 'Prometheus',
  kuma: 'Kuma',
  nut: 'NUT',
  gitea: 'Gitea',
  config: 'JagHelm config',
};
const SUBSYSTEM_ORDER = Object.fromEntries(SUBSYSTEMS.map((s, i) => [s.id, i]));

// What the UPS's entity carries beside its verdict (rules.js judgeUps).
const UPS_READINGS = ['runtimeMinutes', 'runtimeOnMainsMinutes', 'load', 'model'];

// The UPS's readings that drift with its load on a steady board (#586), and
// how long the model holds them as read (holdUpsReadings).
const DRIFTING = ['load', 'runtimeOnMainsMinutes'];
export const UPS_HOLD_MS = 5 * 60_000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const objectOr = (v) => (isObject(v) ? v : {});
const arrayOr = (v) => (Array.isArray(v) ? v : []);

/**
 * Which upstreams answered this cycle, from the flags their payloads carry
 * (#232). A missing payload (a cold cache after a restart, or one past its TTL
 * because the refresh failed) did not answer. A payload without a flag (an
 * older one, or the one written when no nodes are configured) did. Push reads
 * the same flags (push/snapshot.js), so both judge one failure.
 */
export function sourcesOk(servicesCache, upsCache) {
  const services = servicesCache != null;
  return {
    prometheus: services && servicesCache.sources?.prometheus?.ok !== false,
    kuma: services && servicesCache.sources?.kuma?.ok !== false,
    ups: upsCache != null && upsCache.ok !== false,
  };
}

/**
 * What a job's or a backup's entity says beside its verdict (#578), from its
 * last run as the cron store keeps it: `schedule`, in words (schedule.js:
 * the reporter's words as sent, a common cron expression put in words, else
 * the interval, "every 24 h"); `everySeconds`, the interval it is
 * expected at; `lastRun`, when it last reported (ms since the epoch); and
 * `overdue`, by the same rule as /api/cron/status (cron-overdue.js), whatever
 * the verdict's word (a failed backup is still overdue). Each is left out when
 * the run has none it can read. They change only when the job reports, so a
 * steady board's status still holds from cycle to cycle.
 */
function jobFacts(run, now) {
  const out = {};
  const every = run?.expected_every_seconds;
  const schedule = scheduleWords(run?.schedule, every);
  if (schedule) out.schedule = schedule;
  if (Number.isFinite(every) && every > 0) out.everySeconds = every;
  const at = Date.parse(run?.timestamp);
  if (Number.isFinite(at)) out.lastRun = at;
  out.overdue = isOverdue(run, now);
  return out;
}

/** "node:container" -> [node, container] (the part after the first colon). */
function splitUid(uid) {
  const i = uid.indexOf(':');
  return i === -1 ? [uid, uid] : [uid.slice(0, i), uid.slice(i + 1)];
}

/**
 * The entity for `base` and its verdict, with its `since`: kept from last
 * cycle while the state holds, else the verdict's own time (a job's run, a
 * container last seen, an integration's `_status.since`), else `now`.
 *
 * A node serves when each of its held readings' hold began (`heldSince`,
 * #469), from its memo: push's snapshot copies it, so the model is the one
 * place a hold is timed, and it is seeded back from the snapshot at boot.
 */
function settle(base, verdict, before, now) {
  const entity = { ...base, state: verdict.state, word: verdict.word, reason: verdict.reason };
  if (verdict.metric) entity.metric = verdict.metric;
  if (verdict.conditions) entity.conditions = verdict.conditions;
  // A node's drives (status/drives.js), only when this cycle judged some.
  if (verdict.drives) entity.drives = verdict.drives;
  // How often those drives' readings refresh, when declared (#732): display only.
  if (verdict.drives && verdict.driveReadingSeconds) entity.driveReadingSeconds = verdict.driveReadingSeconds;
  // A missing container held long enough to page (#775), judged in rules.js.
  if (verdict.pageDue) entity.pageDue = true;
  // Held drives forgotten this cycle (module off, or 24 h blind): push stays silent.
  if (verdict.driveDropped) entity.driveDropped = true;
  // The UPS's runtime on battery (#549), its runtime on mains, load and model
  // (#586), each null without one (rules.js judgeUps).
  for (const key of UPS_READINGS) if (Object.hasOwn(verdict, key)) entity[key] = verdict[key];
  const held = base.kind === 'node' ? objectOr(verdict.memo?.held) : {};
  const starts = Object.keys(held)
    .filter((k) => Number.isFinite(held[k]))
    .sort();
  if (starts.length > 0) entity.heldSince = Object.fromEntries(starts.map((k) => [k, held[k]]));
  const same =
    before &&
    before.kind === base.kind &&
    before.state === verdict.state &&
    Number.isFinite(before.since);
  entity.since =
    verdict.hold && Number.isFinite(before?.since)
      ? before.since
      : same
        ? before.since
        : (verdict.sinceHint ?? now);
  return { entity, memo: verdict.memo };
}

/**
 * What this cycle knows of one node's drives, for judgeNode (status/drives.js
 * judgeNodeDrives): the module off (`enabled` false), unread (no input: the
 * read failed or hasn't run), or the node's slice of the read.
 *
 * @param {any} drives  inputs.drives (drives.js read), or null
 * @param {string} nodeKey
 * @returns {{ mode: 'off' | 'unread' | 'read', node?: any }}
 */
function drivesOf(drives, nodeKey) {
  if (!isObject(drives)) return { mode: 'unread' };
  if (drives.enabled === false) return { mode: 'off' };
  const nodes = objectOr(drives.nodes);
  return { mode: 'read', node: Object.hasOwn(nodes, nodeKey) ? nodes[nodeKey] : null };
}

/**
 * The Proxmox storage pools each node's reads listed this cycle, by the node
 * they belong to (`_target`'s node, else "pve", as the web reads them), and
 * whether that is the whole list (#468). Returns a lookup: node -> `{ pools,
 * read }`.
 *
 * - A node with a Proxmox entry: `read` only when every one fetched its pools.
 *   A fetch that failed (`_error`, which the refresh stamps with its preset and
 *   target even when the fetch threw), or one with no pool list (its storage
 *   read failed), is a failed read of the node's pools, not "no pools".
 * - A node with no Proxmox entry in the payload has none set up any more (the
 *   integration was removed, disabled or pointed at another node): its pools
 *   were read, as an empty list.
 * - No payload (the integrations refresh failed, or its cache is cold or past
 *   its TTL): no node's pools were read.
 *
 * While a node's pools are not read, a pool the model held a level for keeps it
 * (judgeNode), and push's snapshot keeps it too (push/snapshot.js buildHosts),
 * so a pool's episode ends only when a read no longer lists it.
 *
 * @param {unknown} integrations  the /api/integrations payload
 * @returns {(node: string) => { pools: any[], read: boolean }}
 */
export function proxmoxPools(integrations) {
  const answered = isObject(integrations);
  const byNode = new Map();
  for (const entry of Object.values(objectOr(integrations))) {
    if (!isObject(entry) || entry._preset !== 'proxmox') continue;
    const node = entry._target ? splitUid(String(entry._target))[0] : 'pve';
    const at = byNode.get(node) ?? { pools: [], read: true };
    if (entry._error || !Array.isArray(entry._storagePools)) at.read = false;
    else at.pools.push(...entry._storagePools);
    byNode.set(node, at);
  }
  return (node) => byNode.get(node) ?? { pools: [], read: answered };
}

/**
 * `onDriveFault`, when given, is told once per build whether judging a node's
 * drives threw: the error, or null (the loop logs it once, refresh.js). A throw
 * never stops the build: that node is judged without its drives.
 *
 * @param {{ inputs: any, thresholds: import('./thresholds.js').Thresholds, units?: string, memory?: any, now: number, onDriveFault?: (err: unknown) => void }} args
 * @returns {{ status: any, memory: any }}
 */
export function buildStatus({ inputs, thresholds, units, memory = null, now, onDriveFault }) {
  const prev = objectOr(memory?.entities);
  const prevSources = objectOr(memory?.sources);
  const {
    services = null,
    servicesInternal = null,
    ups = null,
    integrations = null,
    cron = [],
    backupJobs = [],
    restartLimits = {},
    arcaneAgents = null,
    kumaConfigured = false,
    giteaConfigured = false,
    giteaFailure = null,
    refusedSources = {},
    cycleErrors = [],
    configProblem = null,
    drives = null,
    containerEvents = null,
    missingPushAfterMs,
  } = inputs ?? {};

  // Which upstreams answered (#232).
  const ok = sourcesOk(services, ups);
  const internal = objectOr(servicesInternal);
  const nodes = objectOr(services?.nodes);
  const built = new Map(); // id -> { entity, memo }
  const add = (base, verdict) => built.set(base.id, settle(base, verdict, prev[base.id], now));

  // Why a node discovery left unread has no data: its verdict's reason
  // (status/upMissing.js, #476), or null.
  const whyNoUp = objectOr(internal.whyNoUp);
  const unreadReason = (nodeKey) => {
    const why = whyNoUp[nodeKey];
    return typeof why === 'string' && Object.hasOwn(UP_MISSING, why) && UP_MISSING[why].unread
      ? UP_MISSING[why].reason
      : null;
  };

  // Whether a node's container list was read this cycle.
  const containersRead = (nodeKey) => {
    if (!services) return false;
    const node = nodes[nodeKey];
    if (node && Array.isArray(node.failedReads)) return !node.failedReads.includes('containers');
    return ok.prometheus;
  };

  // ── Services: a card per container or monitor, keyed by its uid ──
  const kumaStatusOf = objectOr(internal.kumaStatusOf);
  const backedBy = objectOr(internal.backedBy);
  // A monitor no container carries says so (#644), so a custom group can follow it to another node.
  const placed = objectOr(internal.monitorPlaced);
  const onlyOf = (uid) => (Object.hasOwn(placed, uid) ? { monitorOnly: true } : {});
  for (const [nodeKey, node] of Object.entries(nodes)) {
    for (const card of arrayOr(node?.services)) {
      if (!isObject(card) || typeof card.uid !== 'string') continue;
      const id = `services/${card.uid}`;
      const before = prev[id];
      const name = String(card.display_name || card.container || card.uid);
      const base = (kind) => ({ id, kind, subsystem: 'services', name, node: nodeKey, ...onlyOf(card.uid) });
      if (card.monitored === true || (!ok.kuma && before?.kind === 'service')) {
        add(
          base('service'),
          judgeService({
            status: card.status,
            kumaStatus: kumaStatusOf[card.uid],
            kumaOk: ok.kuma,
            prev: before,
            now,
            thresholds,
          })
        );
      } else {
        add(
          base('container'),
          judgeContainer({
            card,
            backedBy: backedBy[card.uid] ?? null,
            containersRead: containersRead(nodeKey),
            now,
            pushAfterMs: missingPushAfterMs,
          })
        );
      }
    }
  }
  // The Kuma monitors no card is drawn for are services too: the up ones
  // (#390), and the pending and in-maintenance ones (#258). So the count of
  // services doesn't change when one goes down and gets a card.
  const withoutCard = [
    ...arrayOr(internal.upWithoutCard).map((uid) => [uid, 'up']),
    ...Object.entries(objectOr(internal.kumaWithoutCard)),
  ];
  for (const [uid, kumaStatus] of withoutCard) {
    if (typeof uid !== 'string' || built.has(`services/${uid}`)) continue;
    const [nodeKey, name] = splitUid(uid);
    const id = `services/${uid}`;
    add(
      { id, kind: 'service', subsystem: 'services', name, node: nodeKey, ...onlyOf(uid) },
      judgeService({
        status: kumaStatus === 'up' ? 'up' : 'unknown',
        kumaStatus,
        kumaOk: ok.kuma,
        prev: prev[id],
        now,
        thresholds,
      })
    );
  }

  // ── Nodes ──
  const poolsOf = proxmoxPools(integrations);
  const blindNodes = []; // [nodeKey, display name]: nodes that can no longer see their drives
  let driveFault = null;
  for (const [nodeKey, node] of Object.entries(nodes)) {
    if (!isObject(node)) continue;
    const id = `nodes/${nodeKey}`;
    const read = poolsOf(nodeKey);
    const name = String(node.display_name || nodeKey);
    const verdict = judgeNode(node, {
      prometheusOk: ok.prometheus,
      unreadReason: unreadReason(nodeKey),
      pools: read.pools,
      poolsRead: read.read,
      memo: prev[id]?.memo,
      now,
      thresholds,
      units: temperatureUnits(units),
      key: nodeKey,
      drives: drivesOf(drives, nodeKey),
    });
    if (verdict.driveFault) driveFault ??= verdict.driveFault;
    if (verdict.driveBlind) blindNodes.push([nodeKey, name]);
    add({ id, kind: 'node', subsystem: 'nodes', name, node: nodeKey }, verdict);
  }
  if (typeof onDriveFault === 'function') onDriveFault(driveFault);

  // ── Power: the UPS, when one is set up ──
  const upsAnswered = isObject(ups) && ups.ok !== false;
  if (upsAnswered ? ups.configured !== false : !!prev['power/ups']) {
    const name = (upsAnswered && ups.model) || prev['power/ups']?.name || 'UPS';
    const base = { id: 'power/ups', kind: 'ups', subsystem: 'power', name: String(name) };
    const before = prev[base.id];
    built.set(
      base.id,
      holdUpsReadings(settle(base, judgeUps(upsAnswered ? ups : null), before, now), before, now)
    );
  }

  // ── Jobs and backups: the cron store ──
  const backups = new Set(arrayOr(backupJobs));
  for (const nodeEntry of arrayOr(cron)) {
    if (!isObject(nodeEntry) || typeof nodeEntry.node !== 'string') continue;
    for (const j of arrayOr(nodeEntry.jobs)) {
      if (!isObject(j) || typeof j.job !== 'string') continue;
      const key = `${nodeEntry.node}:${j.job}`;
      const backup = backups.has(key);
      const subsystem = backup ? 'backups' : 'jobs';
      const run = arrayOr(j.runs)[0] ?? null;
      add(
        {
          id: `${subsystem}/${key}`,
          kind: backup ? 'backup' : 'job',
          subsystem,
          name: j.job,
          node: nodeEntry.node,
          ...jobFacts(run, now),
        },
        judgeJob({ run, now, backup })
      );
    }
  }

  // ── Integrations, and the Arcane agents (the poller's last read, #291).
  // Arcane's updates, held-back updates, releases and digests are events, not
  // entities (spec §6.2): they stay pushes, and #267 records them. ──
  for (const [key, entry] of Object.entries(objectOr(integrations))) {
    if (!isObject(entry)) continue;
    const base = {
      id: `integrations/${key}`,
      kind: 'integration',
      subsystem: 'integrations',
      name: key,
    };
    if (entry._target) base.node = splitUid(String(entry._target))[0];
    add(base, judgeIntegration(entry, key));
  }
  for (const agent of arrayOr(arcaneAgents)) {
    if (!isObject(agent) || typeof agent.env !== 'string') continue;
    add(
      {
        id: `integrations/arcane:${agent.env}`,
        kind: 'agent',
        subsystem: 'integrations',
        name: `Arcane agent ${agent.env}`,
      },
      judgeAgent(agent)
    );
  }

  // ── Kept from last cycle: what a failed source fed and no longer reports ──
  for (const [id, before] of Object.entries(prev)) {
    if (built.has(id) || !isObject(before)) continue;
    const reason = carriedReason(before, { ok, containersRead, unreadReason, services, integrations });
    if (!reason) continue;
    const base = { id, kind: before.kind, subsystem: before.subsystem, name: before.name };
    if (before.node) base.node = before.node;
    built.set(
      id,
      settle(base, { state: 'unknown', word: 'No signal', reason, memo: before.memo }, before, now)
    );
  }

  // ── Sources ──
  const entityList = [...built.values()].map((b) => b.entity);
  const has = (pred) =>
    entityList.some(pred) || Object.values(prev).some((e) => isObject(e) && pred(e));
  // Why Prometheus or Kuma failed, as the services refresh kept it (its cause,
  // or a failure's text), in words (#605): one sentence per cause, so a raw
  // error that varies (a port) leaves the status, and its ETag, as they were.
  const sourceErrors = objectOr(internal.sourceErrors);
  const failedWith = (name) => (sourceErrors[name] ? failureSentence(name, sourceErrors[name]) : null);
  const found = {};
  // Prometheus: set up when the services payload carries its flag (nodes are
  // configured). The UPS is read through it too.
  // Answering, it can still fail for a node (its verdict on a missing `up`,
  // #476): failed, naming why, while only that node is held.
  if (isObject(services?.sources) || prevSources.prometheus) {
    const failed = !ok.prometheus || !ok.ups;
    const problem = typeof internal.prometheusProblem === 'string' ? internal.prometheusProblem : null;
    const error = !ok.prometheus
      ? failedWith('prometheus') || (services ? null : 'No data from the refresh')
      : 'The UPS query failed';
    found.prometheus = failed
      ? { state: 'failed', error }
      : problem
        ? { state: 'failed', error: problem, answering: true }
        : { state: 'ok' };
  }
  if (kumaConfigured || has((e) => e.kind === 'service')) {
    found.kuma = ok.kuma
      ? { state: 'ok' }
      : {
          state: 'failed',
          error: failedWith('kuma') || (services ? null : 'No data from the refresh'),
        };
  }
  const upsEntity = built.get('power/ups');
  if (upsEntity) {
    const nutQuiet =
      upsAnswered && ups.configured !== false && (ups.status === null || ups.status === undefined);
    if (upsAnswered)
      found.nut = nutQuiet
        ? { state: 'failed', error: 'No reading from the NUT exporter' }
        : { state: 'ok' };
    else
      found.nut = prevSources.nut
        ? { state: prevSources.nut.state, error: prevSources.nut.error }
        : { state: 'ok' };
  }
  // Gitea: failed while its refresh does (the cycle's error set), saying why
  // when its poll kept the failure (gitea.js giteaFailure).
  if (giteaConfigured) {
    found.gitea = arrayOr(cycleErrors).includes('gitea')
      ? { state: 'failed', error: giteaFailure ? failureSentence('gitea', giteaFailure) : 'The Gitea refresh failed' }
      : { state: 'ok' };
  }
  // services.yaml (#505): failed while it is no usable config, and not
  // listed otherwise, so a good file changes nothing. JagHelm then runs on the
  // last good config, or none at boot, so the board alone can't say the
  // file is broken: an empty board would read as calm.
  if (typeof configProblem === 'string' && configProblem) {
    found.config = { state: 'failed', error: configProblem };
  }
  // A node that can no longer see its drives (status/drives.js): one source
  // each, in the unknown state, never the node's own (drive-health design §6).
  for (const [nodeKey, name] of blindNodes) {
    found[`${DRIVES_SOURCE}${nodeKey}`] = { state: 'failed', error: blindReason(name) };
  }
  // A node with no container readings (#838, status/containerBlind.js): one source each,
  // listed while it is blind, or was and the read cannot say.
  const heldBlind = Object.entries(prevSources)
    .filter(([n, e]) => n.startsWith(CONTAINERS_SOURCE) && e?.state === 'failed')
    .map(([n]) => n.slice(CONTAINERS_SOURCE.length));
  const containerBlind = containerBlindNodes(containerEvents, heldBlind)
    .filter((nodeKey) => isObject(nodes[nodeKey]))
    .map((nodeKey) => [nodeKey, String(nodes[nodeKey].display_name || nodeKey)]);
  for (const [nodeKey, name] of containerBlind) {
    found[`${CONTAINERS_SOURCE}${nodeKey}`] = { state: 'failed', error: containerBlindReason(name) };
  }
  // A source URL with a user or password (#419) is never used: its source is
  // off, whatever its refresh left, and the problem names the variable.
  for (const [name, problem] of Object.entries(objectOr(refusedSources))) {
    if (Object.hasOwn(SOURCE_NAMES, name) && typeof problem === 'string' && problem) {
      found[name] = { state: 'failed', error: problem, off: true };
    }
  }
  const sources = {};
  for (const [name, s] of Object.entries(found)) {
    const before = prevSources[name];
    const entry = { state: s.state };
    if (s.state === 'failed' && s.error) entry.error = errorText(s.error);
    entry.since = before?.state === s.state && Number.isFinite(before.since) ? before.since : now;
    sources[name] = entry;
  }
  const issueSources = [...MONITORING_SOURCES, ...Object.keys(found).filter((n) => found[n].off)];
  const driveIssues = blindNodes.map(([nodeKey, name]) => {
    const id = `${DRIVES_SOURCE}${nodeKey}`;
    return {
      id: `sources/${id}`,
      kind: 'source',
      subsystem: 'sources',
      name: `Drive monitoring on ${name}`,
      state: 'unknown',
      word: 'No signal',
      reason: sources[id].error,
      since: sources[id].since,
    };
  });
  const sourceIssues = [...new Set(issueSources)].filter((name) => sources[name]?.state === 'failed').map(
    (name) => ({
      id: `sources/${name}`,
      kind: 'source',
      subsystem: 'sources',
      name: SOURCE_NAMES[name],
      state: 'warn',
      word: found[name].off ? 'Off' : found[name].answering ? 'Failing' : 'Failed',
      reason: sources[name].error || NO_ANSWER,
      since: sources[name].since,
    })
  );
  sourceIssues.push(...driveIssues);
  sourceIssues.push(
    ...containerBlind.map(([nodeKey, name]) => {
      const id = `${CONTAINERS_SOURCE}${nodeKey}`;
      return {
        id: `sources/${id}`,
        kind: 'source',
        subsystem: 'sources',
        name: containerBlindName(name),
        state: 'warn',
        word: 'Failed',
        reason: sources[id].error,
        since: sources[id].since,
      };
    })
  );
  // A restart loop or an OOM kill (#764): issues of the container, not entities of their own.
  const heldLoops = new Set(arrayOr(memory?.containerHeld));
  const conditionIssues = containerConditionIssues(containerEvents, { now, limits: objectOr(restartLimits), held: heldLoops });
  sourceIssues.push(...conditionIssues);
  // Which restart loops are open, for their hysteresis; an unread cycle keeps them.
  const containerHeld =
    containerEvents?.state === 'ok'
      ? conditionIssues.filter((i) => i.condition === 'restart_loop').map((i) => i.id)
      : [...heldLoops];

  // ── The model ──
  const entities = entityList.sort(
    (a, b) =>
      SUBSYSTEM_ORDER[a.subsystem] - SUBSYSTEM_ORDER[b.subsystem] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const empty = isEmptyBoard({ entities, sources, services, integrations });
  // A Compose stack is one row (#642): the entities stay one each, the summary counts rows.
  // Additive: `overall`, `issues` and `subsystems` count every container as
  // they always did; `rows`, present only when a
  // board has a stack, is the same three counted by rows, which the web reads.
  const stacked = withStacks(entities, nodes);
  const { overall, issues, subsystems } = summarize(entities, sourceIssues, { empty });
  const status = { overall, issues, subsystems, entities: stacked.entities, sources, thresholds, units: temperatureUnits(units) };
  if (stacked.any) status.rows = summarize(stacked.rows, sourceIssues, { empty });

  const memEntities = {};
  for (const [id, { entity, memo }] of built) memEntities[id] = memo ? { ...entity, memo } : entity;
  return { status, memory: { entities: memEntities, sources, containerHeld } };
}

/**
 * Sample and hold for the UPS's readings that drift with its load (#586): its
 * `load` and `runtimeOnMainsMinutes` move a little every cycle on a steady
 * board, and served as read they would change the status, and its ETag, every
 * cycle. So the entity serves them as last read (`memo.readAt`), and takes
 * this cycle's only when
 *
 *   - UPS_HOLD_MS (5 minutes) have passed since that read;
 *   - any other field of the entity changed (its state, word, reason, charge,
 *     runtime left, model, name), so whatever else a client is sent comes
 *     with readings from the same read;
 *   - either goes to or from null (no reading, no signal): never a value the
 *     UPS no longer gives, nor none while it gives one.
 *
 * A first cycle, or one after a restart (no UPS in the memory), reads them
 * afresh. So a served reading is at most 5 minutes old when the cycle runs,
 * and a client sees it on its next poll. The runtime left on battery is not
 * held: it counts down (#549), and its change reads the load afresh too.
 *
 * @param {{ entity: any, memo?: any }} built  settle's, for this cycle's read
 * @param {any} before  the entity in the memory, with its memo
 * @param {number} now
 */
function holdUpsReadings(built, before, now) {
  const { entity } = built;
  const readAt = before?.memo?.readAt;
  const rest = (e) => {
    const out = { ...e };
    for (const key of [...DRIFTING, 'since', 'memo']) delete out[key];
    return JSON.stringify(out);
  };
  const fresh =
    !isObject(before) ||
    !Number.isFinite(readAt) ||
    now - readAt >= UPS_HOLD_MS ||
    rest(entity) !== rest(before) ||
    DRIFTING.some((key) => (entity[key] == null) !== (before[key] == null));
  if (fresh) return { entity, memo: { readAt: now } };
  const held = { ...entity };
  for (const key of DRIFTING) held[key] = before[key];
  return { entity: held, memo: { readAt } };
}

/**
 * Whether the board is empty (#449, summary.js EMPTY): nothing is set up, and
 * every read that ran answered. So: no entity; no source listed but
 * Prometheus, and it answered (a Kuma or Gitea that is set up is something
 * set up, whatever it says); and the services and integrations refreshes each
 * left their payload (a refresh that threw, or one past its TTL, leaves none).
 * The UPS read needs no check of its own: it goes through Prometheus, and the
 * services payload always carries Prometheus's flag (with no nodes, from the
 * refresh's probe), so a failed UPS read is a failed Prometheus (above).
 * Anything else with nothing on the board is unknown, never calm.
 */
function isEmptyBoard({ entities, sources, services, integrations }) {
  return (
    entities.length === 0 &&
    Object.entries(sources).every(([name, s]) => name === 'prometheus' && s.state === 'ok') &&
    services != null &&
    isObject(integrations)
  );
}

/**
 * Why an entity the model had last cycle, and doesn't see now, is kept as
 * unknown: the source that fed it failed. null when nothing failed (it is
 * gone: a container removed, a job deleted), so it is dropped. A container
 * list unread on a node discovery left unread has the node's reason
 * (#476); otherwise, while Prometheus answered, it is a node it has not
 * scraped yet (#470).
 */
function carriedReason(before, { ok, containersRead, unreadReason, services, integrations }) {
  switch (before.subsystem) {
    case 'services':
      if (before.kind === 'service' && !ok.kuma) return 'No data: Kuma unreachable';
      if (containersRead(before.node)) return null;
      return (
        unreadReason(before.node) ?? (ok.prometheus ? NOT_SCRAPED : 'No data: Prometheus unreachable')
      );
    case 'nodes':
      return services && ok.prometheus ? null : 'No data: Prometheus unreachable';
    case 'integrations':
      return before.kind === 'integration' && !isObject(integrations)
        ? 'No data: the integrations refresh failed'
        : null;
    default:
      return null; // the UPS is judged above; jobs are pushed to JagHelm and have no source to fail
  }
}
