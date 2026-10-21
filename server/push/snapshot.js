/**
 * The push snapshot, built from the status model (#292). Push judges nothing:
 * it records what the model (server/status/) decided about each entity it
 * pages for, and the differ sends where that changed. So a push says what the
 * screens say, at the same line, and a reading inside a hysteresis band stays
 * on the side the model holds it on (#361).
 *
 * PURE given its inputs: the model's status for this cycle, the previous
 * snapshot, and the caches (only for which sources answered, the monitor
 * identities the services refresh keeps beside its payload, and which nodes'
 * storage pools Proxmox read, #468). No clock, no I/O.
 *
 * Snapshot shape (every map's keys inserted in ascending sorted order):
 *   services:  "NODE:ID" -> "up" | "down" | "unknown", for each service the
 *              model judges from a Kuma monitor (a container with no monitor
 *              never pages)
 *   monitorOf: "NODE:ID" -> the id of the Kuma monitor that fed that service key
 *              (#395); a snapshot written before #395 has none
 *   hosts:     "NODE" -> { reachable, levels: { cpu, mem, disk, temp,
 *              "pool:<name>": "ok" | "warn" | "crit" } }, the model's
 *              `conditions`; a snapshot written before #292 holds readings here
 *   ups:       { state: "online" | "on_battery" | "unknown" }
 *   cron:      "NODE:JOB" -> "success" | "failure" | "overdue" | "unknown"
 *   sources:   "prometheus" | "kuma" | "nut" -> "ok" | "failing" | "down"
 *
 * What the model can't call up or down holds the last known state, so it
 * never pages and loses no recovery: a service pending or in maintenance, an
 * entity whose source failed (the model makes it unknown, with a reason naming
 * the source), a reading whose query failed. A failed monitoring source pages
 * once, itself (sources).
 *
 * Failed sources (#232): beyond that, a source that failed this cycle can drop
 * what it fed from the model altogether (a cold cache after a restart, the
 * container list): the part of the snapshot it feeds is kept from the previous
 * snapshot (see buildSnapshot), rather than read as every host, service or the
 * UPS going away.
 */
import { proxmoxPools, sourcesOk } from '../status/model.js';
import { judgeUps, levelOf, WORDS } from '../status/rules.js';
import { serviceHistory } from './differ.js';

// The monitoring sources whose failure pages (spec §6.1), in key order.
const MONITORING_SOURCES = ['kuma', 'nut', 'prometheus'];
const LEVELS = new Set(['ok', 'warn', 'crit']);
/** No node's storage pools read this cycle (buildHosts' default). */
const NO_POOL_READS = () => ({ pools: [], read: false });

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Build the sorted ascending object from entries [key, value]. */
function sortedObject(entries) {
  const out = {};
  for (const [k, v] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = v;
  }
  return out;
}

/** The model's entities, or none. */
function entitiesOf(status) {
  return Array.isArray(status?.entities) ? status.entities : [];
}

/** The part of a model id after its subsystem ("services/vm103:gitea" -> "vm103:gitea"). */
const keyOf = (id) => id.slice(id.indexOf('/') + 1);

/** A monitorOf map with its ids as strings, junk dropped (uid -> monitor id). */
function monitorIds(monitorOf) {
  if (!isObject(monitorOf)) return {};
  const out = {};
  for (const [uid, id] of Object.entries(monitorOf)) {
    const valid =
      typeof id === 'string' ? id !== '' : typeof id === 'number' && Number.isFinite(id);
    if (valid) out[uid] = String(id);
  }
  return out;
}

/**
 * A service's state for push, from the model: down when it is crit (Kuma says
 * down), up when it is ok, and null, hold the last known, for everything else:
 * pending (ok on its first cycle, warn after), maintenance, and no signal
 * (#258's Pending is "hold the last known state" for push, #292).
 */
export function serviceStateOf(entity) {
  if (entity?.state === 'crit') return 'down';
  if (entity?.state === 'ok' && entity.word !== WORDS.pending) return 'up';
  return null;
}

/**
 * The services map: each service entity of the model (a card a Kuma monitor
 * gives its state, and each monitor no card is drawn for) as up or down, or
 * held at the state the differ would diff it from (serviceHistory: its own,
 * or its monitor's when the monitor's key moved).
 *
 * `upWithoutCard` (#390), the uids of the up Kuma monitors no card is drawn
 * for, is kept beside the payload (it is not served). The model reads such a
 * monitor as an up service, unless a grey presence breadcrumb has its uid: the
 * model then judges the breadcrumb. The entry still reads as up here, so its
 * recovery diffs on the key of its down push; placement skips every other
 * card's uid, so a breadcrumb, normally of the monitor's own stopped
 * container, is the only thing that can share it.
 *
 * @param {any} status
 * @param {{ prev?: any, monitorOf?: Record<string, string>, upWithoutCard?: unknown }} [ctx]
 *   prev: the previous snapshot; monitorOf: this cycle's monitor ids (monitorIds)
 */
export function buildServices(status, { prev = null, monitorOf = {}, upWithoutCard = [] } = {}) {
  const prevServices = isObject(prev?.services) ? prev.services : {};
  const history = serviceHistory(
    prevServices,
    buildMonitorOf(prev?.monitorOf, prevServices),
    monitorOf
  );
  const out = new Map();
  const kindOf = new Map();
  for (const e of entitiesOf(status)) {
    if (typeof e?.id !== 'string' || !e.id.startsWith('services/')) continue;
    const uid = keyOf(e.id);
    kindOf.set(uid, e.kind);
    if (e.kind === 'service') out.set(uid, serviceStateOf(e) ?? history(uid));
  }
  for (const uid of Array.isArray(upWithoutCard) ? upWithoutCard : []) {
    if (typeof uid === 'string' && kindOf.get(uid) !== 'service') out.set(uid, 'up');
  }
  return sortedObject([...out]);
}

/**
 * The Kuma monitor that fed each key of `services` this cycle (#395). The
 * services refresh keeps `monitorOf` (uid -> monitor id) beside the cached
 * payload, like upWithoutCard (it is not served): the running cards that have a
 * monitor, the red cards of monitors no running container got, those
 * monitors' up entries, and the pending or in-maintenance ones no card is
 * drawn for. The differ carries a monitor's state across a move of its key
 * with it. Only the keys in `services` are kept, ids as strings, sorted.
 */
export function buildMonitorOf(monitorOf, services) {
  const ids = monitorIds(monitorOf);
  const known = isObject(services) ? services : {};
  return sortedObject(Object.entries(ids).filter(([uid]) => Object.hasOwn(known, uid)));
}

/**
 * The hosts map: each node of the model, reachable or not, with the level of
 * each reading (its `conditions`: hysteresis and CPU's 2 cycles applied).
 * What the model could not read holds: a reading whose query failed keeps its
 * level, and a node with no data at all (its `up` read failed, or Prometheus
 * failed and it is carried over) keeps its whole entry. A reading with no
 * value this cycle (a sensor that didn't answer) keeps its level too, and an
 * unreachable node keeps every level for when it comes back.
 *
 * A storage pool holds the same way while its node's pools were not read (a
 * Proxmox fetch failed, #468), as the model holds it. It leaves the map when
 * the model ends its episode: on a cycle the model judged the node's readings
 * and the node's pools were read (`poolsOf`, model.js proxmoxPools) without it,
 * which includes a node no Proxmox entry names any more. The differ then sends
 * its clear if it was over its line.
 *
 * @param {any} status
 * @param {Record<string, any>} [prevHosts]
 * @param {(node: string) => { pools: any[], read: boolean }} [poolsOf]  this
 *   cycle's proxmoxPools; without it, no node's pools were read
 */
export function buildHosts(status, prevHosts = {}, poolsOf = NO_POOL_READS) {
  const held = isObject(prevHosts) ? prevHosts : {};
  const entries = [];
  for (const e of entitiesOf(status)) {
    if (e?.kind !== 'node' || typeof e.id !== 'string') continue;
    const node = keyOf(e.id);
    const before = Object.hasOwn(held, node) ? held[node] : null;
    const levels = isObject(before?.levels) ? { ...before.levels } : {};
    if (e.state === 'crit' && e.word === WORDS.unreachable) {
      entries.push([node, { reachable: false, levels: sortedObject(Object.entries(levels)) }]);
      continue;
    }
    if (!isObject(e.conditions)) {
      if (before) entries.push([node, before]); // no data: hold
      continue;
    }
    for (const [reading, level] of Object.entries(e.conditions)) {
      if (LEVELS.has(level)) levels[reading] = level;
    }
    const read = poolsOf(node);
    if (read.read) {
      // The pools the model judged (status/rules.js judgeNode takes only named ones).
      const listed = new Set(
        read.pools.filter((p) => typeof p?.name === 'string').map((p) => `pool:${p.name}`)
      );
      for (const reading of Object.keys(levels)) {
        if (reading.startsWith('pool:') && !listed.has(reading)) delete levels[reading];
      }
    }
    entries.push([node, { reachable: true, levels: sortedObject(Object.entries(levels)) }]);
  }
  return sortedObject(entries);
}

/**
 * The UPS state, from the model's UPS: on battery or low battery (crit) is
 * on_battery, on mains (ok) online, anything else (no data, NUT quiet) holds,
 * so an exporter blip mid-outage neither pages again nor sends a false "back
 * on mains". "unknown" is left only when no state was ever known, and going
 * on battery from it pages (#448). null when the model has no UPS this cycle.
 */
export function buildUps(status, prevUps = null) {
  const e = entitiesOf(status).find((x) => x?.id === 'power/ups');
  if (!e) return null;
  if (e.state === 'crit') return { state: 'on_battery' };
  if (e.state === 'ok') return { state: 'online' };
  return { state: prevUps?.state ?? 'unknown' };
}

/**
 * How push reads a NUT status (the /api/ups payload's `status`): through the
 * status model's UPS rule (status/rules.js judgeUps) and buildUps, as each
 * cycle does: 1 online; 2 and 3 (on battery, low battery) on_battery, so a
 * jump from mains to low battery still pages; anything else unknown. The
 * Android app keeps its own copy of this map until it reads the model;
 * mobile/src/data/upsStatusParity.test.js holds the two together (#273).
 */
export function normalizeUpsStatus(raw) {
  const verdict = judgeUps({ status: raw, ok: true, configured: true });
  return buildUps({ entities: [{ id: 'power/ups', ...verdict }] })?.state ?? 'unknown';
}

/**
 * The cron map: each job (and each job marked as a backup) as the model judged
 * its latest run: ok is success, a failed run failure, an overdue one overdue
 * (the model's status word tells the two warnings apart), anything else holds.
 */
export function buildCron(status, prevCron = {}) {
  const held = isObject(prevCron) ? prevCron : {};
  const entries = [];
  for (const e of entitiesOf(status)) {
    if ((e?.kind !== 'job' && e?.kind !== 'backup') || typeof e.id !== 'string') continue;
    const key = keyOf(e.id);
    let state = null;
    if (e.state === 'ok') state = 'success';
    else if (e.word === WORDS.failed) state = 'failure';
    else if (e.word === WORDS.overdue) state = 'overdue';
    entries.push([key, state ?? (Object.hasOwn(held, key) ? held[key] : 'unknown')]);
  }
  return sortedObject(entries);
}

/**
 * Each monitoring source the model lists: ok, or failing on its first failed
 * cycle, and down from its second in a row (#292: one push, after about a
 * minute, so a blip pages nothing). A source the model doesn't list this cycle
 * (the services payload is missing, so it can't say) keeps its last state.
 */
export function buildSources(status, prevSources = {}) {
  const held = isObject(prevSources) ? prevSources : {};
  const listed = isObject(status?.sources) ? status.sources : {};
  const entries = [];
  for (const name of MONITORING_SOURCES) {
    const before = Object.hasOwn(held, name) ? held[name] : undefined;
    const s = listed[name];
    if (!isObject(s)) {
      if (before !== undefined) entries.push([name, before]);
      continue;
    }
    if (s.state !== 'failed') entries.push([name, 'ok']);
    else entries.push([name, before === 'failing' || before === 'down' ? 'down' : 'failing']);
  }
  return sortedObject(entries);
}

/**
 * The services map to diff, given which sources answered, with the monitor
 * that fed each of its keys (#395): a key kept from `prev` keeps the monitor it
 * had there. Kuma sets every service status that can page, so while it fails
 * the previous map is kept whole. While Prometheus fails, the running-container
 * list is incomplete: a service missing from this cycle keeps its previous
 * status, and one present (a Kuma outage card, or the up entry of a monitor
 * whose container wasn't seen) takes this cycle's, so Kuma keeps paging through
 * a Prometheus outage. A recovery during it is sent when Kuma reports it, since
 * with no container seen the up monitor is an entry under its card's uid
 * (#390), unless no node could be read at all: then nothing is placed, and it
 * is sent once the container is seen again.
 */
function keepServices(prev, services, monitorOf, ok) {
  const prevServices = prev.services ?? {};
  const prevMonitorOf = buildMonitorOf(prev.monitorOf, prevServices);
  if (!ok.kuma) return { services: prevServices, monitorOf: prevMonitorOf };
  if (!ok.prometheus) {
    const kept = sortedObject(Object.entries({ ...prevServices, ...services }));
    const owners = [];
    for (const key of Object.keys(kept)) {
      const from = Object.hasOwn(services, key) ? monitorOf : prevMonitorOf;
      if (Object.hasOwn(from, key)) owners.push([key, from[key]]);
    }
    return { services: kept, monitorOf: sortedObject(owners) };
  }
  return { services, monitorOf };
}

/** A host in `prev` but missing from this cycle while Prometheus failed is kept whole. */
function keepHosts(prevHosts, hosts, ok) {
  if (ok.prometheus) return hosts;
  const entries = Object.entries(hosts);
  for (const [node, before] of Object.entries(prevHosts)) {
    if (!Object.hasOwn(hosts, node)) entries.push([node, before]);
  }
  return sortedObject(entries);
}

/**
 * Build the canonical, byte-deterministic Snapshot from this cycle's status
 * model. PURE given its inputs. The six top-level keys are emitted in a fixed
 * order; every sub-map is ascending-sorted by key.
 *
 * `prev` is the snapshot the result will be diffed against: what the model
 * can't call holds its state from it (buildServices, buildHosts, buildUps,
 * buildCron), and for a source that failed this cycle the part it feeds is
 * kept from it where the model has nothing to say: services (with the monitor
 * of each) while Kuma fails and, as keepServices describes, while Prometheus
 * fails; hosts missing while Prometheus fails; the UPS while its read fails.
 * Cron is pushed to JagHelm and has no upstream to fail.
 *
 * With no `prev` (a first run, or a missing or unreadable file) this cycle's
 * values are all there is, whatever the sources say (#461): the differ diffs
 * them from no previous state (#448). A source that failed is in `sources` as
 * on any cycle, so its second failed cycle in a row sends its source_down
 * (#439); what it feeds is unknown in the model, so it is left out (a host) or
 * `unknown` (a service, the UPS), which sends nothing, and it is new once the
 * source answers: what is in trouble then pages once.
 *
 * There used to be a wait here: no snapshot until the UPS read and Prometheus
 * answered (#232), because the first snapshot was never diffed and what it
 * recorded during an outage was compared against later (a host recorded
 * unreachable sent host_recovered, an "unknown" UPS kept a later on_battery
 * silent). Since #448 neither can happen: a host Prometheus didn't read isn't
 * in the snapshot, and when it is read it is new, so it sends no recovery; the
 * UPS pages going on battery from `unknown`. The wait only silenced push.
 *
 * @param {{ getCached: (key: string) => *, getCachedInternal?: (key: string) => * }} caches
 * @param {object|null} prev
 * @param {any} status  the status model built from the same caches this cycle
 * @returns {object}
 */
export function buildSnapshot(caches, prev, status) {
  const servicesCache = caches.getCached('services');
  const upsCache = caches.getCached('ups');
  const ok = sourcesOk(servicesCache, upsCache);
  const internal = caches.getCachedInternal?.('services');
  const services = buildServices(status, {
    prev,
    monitorOf: monitorIds(internal?.monitorOf),
    upWithoutCard: internal?.upWithoutCard,
  });
  const monitorOf = buildMonitorOf(internal?.monitorOf, services);
  const hosts = buildHosts(status, prev?.hosts, proxmoxPools(caches.getCached('integrations')));
  const kept = prev ? keepServices(prev, services, monitorOf, ok) : { services, monitorOf };
  const ups = buildUps(status, prev?.ups);
  return {
    services: kept.services,
    monitorOf: kept.monitorOf,
    hosts: prev ? keepHosts(prev.hosts ?? {}, hosts, ok) : hosts,
    ups: ups ?? (prev && !ok.ups ? (prev.ups ?? { state: 'unknown' }) : { state: 'unknown' }),
    cron: buildCron(status, prev?.cron),
    sources: buildSources(status, prev?.sources),
  };
}

/**
 * The level of each host reading a snapshot holds, by node, for the status
 * model's memory at boot (status/index.js memoryFromLevels, #361): a restart
 * keeps every episode push last persisted. A snapshot written before #292
 * holds the readings themselves: a reading at or over its line was over it for
 * the push of that version, and is seeded at the level that line gives.
 *
 * @param {object|null} snapshot
 * @param {import('../status/thresholds.js').Thresholds} thresholds
 * @returns {Record<string, Record<string, string>>}
 */
export function heldLevels(snapshot, thresholds) {
  const out = {};
  const hosts = isObject(snapshot?.hosts) ? snapshot.hosts : {};
  for (const [node, host] of Object.entries(hosts)) {
    if (!isObject(host)) continue;
    if (isObject(host.levels)) {
      // Only level words: anything else in a damaged file is left out.
      out[node] = Object.fromEntries(Object.entries(host.levels).filter(([, v]) => LEVELS.has(v)));
      continue;
    }
    const legacy = {};
    for (const reading of ['cpu', 'mem', 'disk']) {
      const v = host[reading];
      if (typeof v === 'number' && Number.isFinite(v))
        legacy[reading] = levelOf(v, undefined, thresholds[reading], 0);
    }
    out[node] = legacy;
  }
  return out;
}

/**
 * When each held reading's hold began, by node (#469), for the status model's
 * memory at boot beside heldLevels (status/index.js memoryFromLevels), so a
 * restart doesn't start a hold's 24 h again. Only times for a reading the host
 * holds a level for; a snapshot written before #469 has none, and its holds
 * start on the first cycle that reads it (status/rules.js holdSince).
 *
 * @param {object|null} snapshot
 * @returns {Record<string, Record<string, number>>}
 */
export function heldSinceOf(snapshot) {
  const out = {};
  const hosts = isObject(snapshot?.hosts) ? snapshot.hosts : {};
  for (const [node, host] of Object.entries(hosts)) {
    const since = startsOf(host);
    if (Object.keys(since).length > 0) out[node] = since;
  }
  return out;
}

/** A host entry's hold starts: a time for each reading it holds a level for, junk left out. */
function startsOf(host) {
  if (!isObject(host) || !isObject(host.heldSince) || !isObject(host.levels)) return {};
  return Object.fromEntries(
    Object.entries(host.heldSince).filter(
      ([reading, at]) => Object.hasOwn(host.levels, reading) && Number.isFinite(at)
    )
  );
}

/**
 * A snapshot as this version writes it. One written before #292 holds each
 * host's readings, not their levels: each host gets the levels those readings
 * give (heldLevels), so the first cycle after the deploy compares levels like
 * any other, and a reading that crossed its line since the old file was
 * written alerts at once. Anything else is returned as it is.
 *
 * @param {object|null} snapshot
 * @param {import('../status/thresholds.js').Thresholds} thresholds
 */
export function upgradeSnapshot(snapshot, thresholds) {
  const hosts = isObject(snapshot?.hosts) ? snapshot.hosts : null;
  if (!hosts || Object.values(hosts).every((h) => !isObject(h) || isObject(h.levels)))
    return snapshot;
  const levels = heldLevels(snapshot, thresholds);
  const upgraded = Object.entries(hosts).map(([node, host]) => [
    node,
    isObject(host) && !isObject(host.levels)
      ? {
          reachable: host.reachable === true,
          levels: sortedObject(Object.entries(levels[node] ?? {})),
        }
      : host,
  ]);
  return { ...snapshot, hosts: sortedObject(upgraded) };
}
