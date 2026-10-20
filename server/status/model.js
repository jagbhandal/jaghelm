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
 * §4.7): `overall`, `issues`, `subsystems`, `entities`, `sources`. `memory` is for the next call only and is never served.
 *
 * Failed sources (#232): a source that failed this cycle makes the entities it
 * feeds `unknown`, with a reason naming it, never `crit`. An entity it fed last
 * cycle that is missing now (Prometheus failing drops the container list, a
 * node, the UPS) is kept, as `unknown`, until the source answers again. The
 * failed source is itself one `warn` issue.
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
import { SUBSYSTEMS, summarize } from './summary.js';

// The monitoring sources whose failure is an issue (spec §6.1), and their names.
const MONITORING_SOURCES = ['prometheus', 'kuma', 'nut'];
const SOURCE_NAMES = { prometheus: 'Prometheus', kuma: 'Kuma', nut: 'NUT', gitea: 'Gitea' };
const SUBSYSTEM_ORDER = Object.fromEntries(SUBSYSTEMS.map((s, i) => [s.id, i]));

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

/** "node:container" -> [node, container] (the part after the first colon). */
function splitUid(uid) {
  const i = uid.indexOf(':');
  return i === -1 ? [uid, uid] : [uid.slice(0, i), uid.slice(i + 1)];
}

/**
 * The entity for `base` and its verdict, with its `since`: kept from last
 * cycle while the state holds, else the verdict's own time (a job's run, a
 * container last seen, an integration's `_status.since`), else `now`.
 */
function settle(base, verdict, before, now) {
  const entity = { ...base, state: verdict.state, word: verdict.word, reason: verdict.reason };
  if (verdict.metric) entity.metric = verdict.metric;
  if (verdict.conditions) entity.conditions = verdict.conditions;
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

/** Proxmox storage pools by the node they belong to (`_target`'s node, else "pve", as the web reads them). */
function poolsByNode(integrations) {
  const out = new Map();
  for (const entry of Object.values(objectOr(integrations))) {
    if (!isObject(entry) || entry._preset !== 'proxmox' || !Array.isArray(entry._storagePools))
      continue;
    const node = entry._target ? splitUid(String(entry._target))[0] : 'pve';
    out.set(node, [...(out.get(node) ?? []), ...entry._storagePools]);
  }
  return out;
}

/**
 * @param {{ inputs: any, thresholds: import('./thresholds.js').Thresholds, memory?: any, now: number }} args
 * @returns {{ status: any, memory: any }}
 */
export function buildStatus({ inputs, thresholds, memory = null, now }) {
  const prev = objectOr(memory?.entities);
  const prevSources = objectOr(memory?.sources);
  const {
    services = null,
    servicesInternal = null,
    ups = null,
    integrations = null,
    cron = [],
    backupJobs = [],
    arcaneAgents = null,
    kumaConfigured = false,
    giteaConfigured = false,
    cycleErrors = [],
  } = inputs ?? {};

  // Which upstreams answered (#232).
  const ok = sourcesOk(services, ups);
  const internal = objectOr(servicesInternal);
  const nodes = objectOr(services?.nodes);
  const built = new Map(); // id -> { entity, memo }
  const add = (base, verdict) => built.set(base.id, settle(base, verdict, prev[base.id], now));

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
  for (const [nodeKey, node] of Object.entries(nodes)) {
    for (const card of arrayOr(node?.services)) {
      if (!isObject(card) || typeof card.uid !== 'string') continue;
      const id = `services/${card.uid}`;
      const before = prev[id];
      const name = String(card.display_name || card.container || card.uid);
      const base = (kind) => ({ id, kind, subsystem: 'services', name, node: nodeKey });
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
      { id, kind: 'service', subsystem: 'services', name, node: nodeKey },
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
  const pools = poolsByNode(integrations);
  for (const [nodeKey, node] of Object.entries(nodes)) {
    if (!isObject(node)) continue;
    const id = `nodes/${nodeKey}`;
    add(
      {
        id,
        kind: 'node',
        subsystem: 'nodes',
        name: String(node.display_name || nodeKey),
        node: nodeKey,
      },
      judgeNode(node, {
        prometheusOk: ok.prometheus,
        pools: pools.get(nodeKey) ?? [],
        memo: prev[id]?.memo,
        thresholds,
      })
    );
  }

  // ── Power: the UPS, when one is set up ──
  const upsAnswered = isObject(ups) && ups.ok !== false;
  if (upsAnswered ? ups.configured !== false : !!prev['power/ups']) {
    const name = (upsAnswered && ups.model) || prev['power/ups']?.name || 'UPS';
    add(
      { id: 'power/ups', kind: 'ups', subsystem: 'power', name: String(name) },
      judgeUps(upsAnswered ? ups : null)
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
      add(
        {
          id: `${subsystem}/${key}`,
          kind: backup ? 'backup' : 'job',
          subsystem,
          name: j.job,
          node: nodeEntry.node,
        },
        judgeJob({ run: arrayOr(j.runs)[0] ?? null, now, backup })
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
    add(base, judgeIntegration(entry));
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
    const reason = carriedReason(before, { ok, containersRead, services, integrations });
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
  const sourceErrors = objectOr(internal.sourceErrors);
  const found = {};
  // Prometheus: set up when the services payload carries its flag (nodes are
  // configured). The UPS is read through it too.
  if (isObject(services?.sources) || prevSources.prometheus) {
    const failed = !ok.prometheus || !ok.ups;
    const error = !ok.prometheus
      ? sourceErrors.prometheus || (services ? null : 'No data from the refresh')
      : 'The UPS query failed';
    found.prometheus = failed ? { state: 'failed', error } : { state: 'ok' };
  }
  if (kumaConfigured || has((e) => e.kind === 'service')) {
    found.kuma = ok.kuma
      ? { state: 'ok' }
      : {
          state: 'failed',
          error: sourceErrors.kuma || (services ? null : 'No data from the refresh'),
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
  if (giteaConfigured) {
    found.gitea = arrayOr(cycleErrors).includes('gitea')
      ? { state: 'failed', error: 'The Gitea refresh failed' }
      : { state: 'ok' };
  }
  const sources = {};
  for (const [name, s] of Object.entries(found)) {
    const before = prevSources[name];
    const entry = { state: s.state };
    if (s.state === 'failed' && s.error) entry.error = errorText(s.error);
    entry.since = before?.state === s.state && Number.isFinite(before.since) ? before.since : now;
    sources[name] = entry;
  }
  const sourceIssues = MONITORING_SOURCES.filter((name) => sources[name]?.state === 'failed').map(
    (name) => ({
      id: `sources/${name}`,
      kind: 'source',
      subsystem: 'sources',
      name: SOURCE_NAMES[name],
      state: 'warn',
      word: 'Failed',
      reason: sources[name].error || 'No answer this cycle',
      since: sources[name].since,
    })
  );

  // ── The model ──
  const entities = entityList.sort(
    (a, b) =>
      SUBSYSTEM_ORDER[a.subsystem] - SUBSYSTEM_ORDER[b.subsystem] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const empty = isEmptyBoard({ entities, sources, services, integrations });
  const { overall, issues, subsystems } = summarize(entities, sourceIssues, { empty });
  const status = { overall, issues, subsystems, entities, sources };

  const memEntities = {};
  for (const [id, { entity, memo }] of built) memEntities[id] = memo ? { ...entity, memo } : entity;
  return { status, memory: { entities: memEntities, sources } };
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
 * list unread while Prometheus answered is a node it has not scraped yet
 * (#470).
 */
function carriedReason(before, { ok, containersRead, services, integrations }) {
  switch (before.subsystem) {
    case 'services':
      if (before.kind === 'service' && !ok.kuma) return 'No data: Kuma unreachable';
      if (containersRead(before.node)) return null;
      return ok.prometheus ? NOT_SCRAPED : 'No data: Prometheus unreachable';
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
