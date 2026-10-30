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
 * storage pools Proxmox read, #468). No clock, no I/O: a held reading is timed
 * by the model, whose starts it copies (#469).
 *
 * Snapshot shape (every map's keys inserted in ascending sorted order):
 *   services:  "NODE:ID" -> "up" | "down" | "unknown", for each service the
 *              model judges from a Kuma monitor (a container with no monitor
 *              never pages)
 *   monitorOf: "NODE:ID" -> the id of the Kuma monitor that fed that service key
 *              (#395); a snapshot written before #395 has none
 *   hosts:     "NODE" -> { reachable, levels: { cpu, mem, disk, temp,
 *              "pool:<name>", "drive:<node>:<device>": "ok" | "warn" |
 *              "crit" }, heldSince? }, the
 *              model's `conditions`; `heldSince` (#469), only while the host
 *              has a reading held with no value: reading -> when its hold
 *              began (ms since the epoch), the model's node `heldSince`; a
 *              snapshot written before #292 holds readings here
 *   ups:       { state: "online" | "on_battery" | "unknown" }
 *   tempNames: "NODE:<12 hex>_<name>" -> "warn" | "ok", a container running
 *              under a temporary name (#772), left out while there is none
 *   missing:   "NODE:CONTAINER" -> "warn" | "ok", an established container gone
 *              long enough to page (#775), left out while there is none
 *   containerConditions: "NODE:CONTAINER:CONDITION" -> "warn" | "ok", a container in
 *              a restart loop or OOM-killed in the last hour (#764); left out
 *              while there is none
 *   cron:      "NODE:JOB" -> "success" | "failure" | "overdue" | "unknown"
 *   sources:   "prometheus" | "kuma" | "nut" -> "ok" | "failing" | "down";
 *              and "status", the status model itself (#440), only while it
 *              throws ("failing", then "down") and "ok" on the cycle it builds
 *              again after it paged; and "config", services.yaml (#505), the
 *              same way, while it is no usable config; and
 *              "drives-source:<node>", a node that had drives and can no
 *              longer see them (status/drives.js), the same way
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
 *
 * A status model that throws (#440) leaves a cycle with no status: then the
 * snapshot is the previous one as it was, but for the status check's own run
 * of failed cycles (cycleSnapshot), which pages like a failed source.
 */
import { proxmoxPools, sourcesOk } from '../status/model.js';
import { DRIVES_SOURCE } from '../status/drives.js';
import { judgeUps, levelOf, tempNameOf, WORDS } from '../status/rules.js';
import { CONFIG_SOURCE, serviceHistory, STATUS_CHECK } from './differ.js';

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
 * The containers running under a temporary name (#772), by the card's uid:
 * warn while the model words it so (WORDS.tempName), ok for the one cycle
 * after the container runs under its real name (the recovery), dropped the
 * cycle after. A temporary container that is gone while its real name is
 * missing, or unjudged (a failed read), stays warn; one gone with no card of
 * the real name at all is dropped, sending nothing. While Prometheus fails
 * the previous map is kept under this cycle's warnings.
 *
 * @param {any} status
 * @param {unknown} prevTempNames  the previous snapshot's map
 * @param {boolean} prometheusOk
 * @returns {Record<string, 'warn' | 'ok'>}
 */
export function buildTempNames(status, prevTempNames, prometheusOk = true) {
  const prev = isObject(prevTempNames) ? prevTempNames : {};
  const byId = new Map(entitiesOf(status).map((e) => [e?.id, e]));
  const out = new Map();
  for (const e of byId.values()) {
    if (e?.kind === 'container' && e.word === WORDS.tempName && typeof e.id === 'string')
      out.set(keyOf(e.id), 'warn');
  }
  for (const [key, before] of Object.entries(prev)) {
    if (before !== 'warn' || out.has(key)) continue;
    if (!prometheusOk) {
      out.set(key, 'warn');
      continue;
    }
    const real = tempNameOf(key.slice(key.indexOf(':') + 1));
    const card = real === null ? null : byId.get(`services/${key.slice(0, key.indexOf(':'))}:${real}`);
    if (!card) continue;
    const running = card.state === 'ok' && (card.kind === 'container' || card.kind === 'service');
    out.set(key, running ? 'ok' : 'warn');
  }
  return sortedObject([...out]);
}

/**
 * The containers missing long enough to page (#775), by the card's uid: warn
 * while the model says the grey Missing card is due (`pageDue`, rules.js
 * judgeContainer: the one place the hold is timed, and a container a Kuma
 * monitor judges is never due), and ok for the one cycle after it runs again,
 * on its node or another (the recovery), dropped the cycle after. A card that
 * is gone without the container running (Remove, the 24 h fade) ends it
 * silently, as does one a monitor has taken over. While Prometheus fails, or
 * the card reads No signal, what was held stays. So does a card whose node is
 * unread (`unreadNodes`, #800) and which runs nowhere else: assembleServices
 * draws no grey card for a node it could not read, so the card's absence says
 * nothing, and dropping the entry would page the same outage again when the
 * node is read. The caller passes `prometheusOk` false too while presence is
 * unknown board-wide (no Missing card is drawn on any node, services
 * `presenceKnown`).
 *
 * @param {any} status
 * @param {unknown} prevMissing  the previous snapshot's map
 * @param {boolean} prometheusOk
 * @param {ReadonlySet<string>} [unreadNodes]  the nodes with a failed read this cycle
 * @returns {Record<string, 'warn' | 'ok'>}
 */
export function buildMissing(status, prevMissing, prometheusOk = true, unreadNodes = new Set()) {
  const prev = isObject(prevMissing) ? prevMissing : {};
  const entities = entitiesOf(status);
  const byId = new Map(entities.map((e) => [e?.id, e]));
  const out = new Map();
  for (const e of entities) {
    if (e?.kind === 'container' && e.word === WORDS.missing && e.pageDue === true && typeof e.id === 'string')
      out.set(keyOf(e.id), 'warn');
  }
  const running = (e) => e?.state === 'ok' && (e.kind === 'container' || e.kind === 'service');
  for (const [key, before] of Object.entries(prev)) {
    if (before !== 'warn' || out.has(key)) continue;
    if (!prometheusOk) {
      out.set(key, 'warn');
      continue;
    }
    const card = byId.get(`services/${key}`);
    // Running again: on its node, or on another (a name is present anywhere it runs).
    const name = key.slice(key.indexOf(':') + 1);
    const back = running(card) || entities.some((e) => typeof e?.id === 'string' && e.id.endsWith(`:${name}`) && running(e));
    if (back) out.set(key, 'ok');
    // Not seen running, and no signal on its card, or its card absent because its node is unread: held (#800).
    else if (card?.state === 'unknown' || (!card && unreadNodes.has(key.slice(0, key.indexOf(':'))))) out.set(key, 'warn');
  }
  return sortedObject([...out]);
}

/**
 * The container conditions that page (#764): `restart_loop` and `oom_kill`,
 * by `NODE:CONTAINER:CONDITION`. warn while the model lists the issue
 * (containerConditions.js), ok for the one cycle after it clears, dropped the
 * cycle after: the same one-shot life as a missing container (buildMissing).
 * What was held stays warn while the events cannot say it cleared: the read
 * did not answer (`read` is not an `ok` read: Prometheus or cAdvisor down, no
 * read yet, aged out), an OOM kill whose counter is not exported or whose events
 * were cut at the cap, or the container's node is one `blindNodes` names (no
 * container readings in the range), so a gap is never a recovery.
 *
 * @param {any} status
 * @param {unknown} prevConditions  the previous snapshot's map
 * @param {any} read  the `containerEvents` cache value, or null
 * @returns {Record<string, 'warn' | 'ok'>}
 */
export function buildContainerConditions(status, prevConditions, read) {
  const prev = isObject(prevConditions) ? prevConditions : {};
  const out = new Map();
  const issues = Array.isArray(status?.issues) ? status.issues : [];
  for (const i of issues) {
    if (i?.kind === 'container' && typeof i.condition === 'string' && typeof i.id === 'string')
      out.set(keyOf(i.id), 'warn');
  }
  const answered = isObject(read) && read.state === 'ok';
  const blind = new Set(isObject(read) && Array.isArray(read.blindNodes) ? read.blindNodes : []);
  for (const [key, before] of Object.entries(prev)) {
    if (before !== 'warn' || out.has(key)) continue;
    // An OOM counter that is absent, or events cut at the cap, cannot say a kill is gone.
    const cannotSay = key.endsWith(':oom_kill') && (read?.truncated === true || read?.oomCounter === false);
    out.set(key, !answered || cannotSay || blind.has(key.slice(0, key.indexOf(':'))) ? 'warn' : 'ok');
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
 * each reading (its `conditions`: hysteresis and CPU's 30 min hold applied).
 * What the model could not read holds: a reading whose query failed keeps its
 * level, and a node with no data at all (its `up` read failed, or Prometheus
 * failed and it is carried over) keeps its whole entry. A reading with no
 * value this cycle (a sensor that didn't answer) keeps its level too, and an
 * unreachable node keeps every level for when it comes back.
 *
 * A storage pool holds the same way while its node's pools were not read (a
 * Proxmox fetch failed, #468), as the model holds it.
 *
 * The model is the one place a hold is timed (#469): each node serves when
 * each of its holds began (`heldSince`, status/rules.js judgeNode), and the
 * entry copies it, never working one out from `prevHosts`. A reading kept
 * from `prevHosts` with no level read this cycle stays while the model still
 * holds it: it has a start (no value), its condition is `unknown` (its read
 * failed, or it is held over its line), or it is a pool whose node's pools
 * were not read. Otherwise the model holds it no more and it leaves the map
 * on this cycle, as it left the model: a pool a read no longer lists (#468,
 * which includes a node no Proxmox entry names any more), or a reading whose
 * 24 h with no value are up (#469). The differ sends the first one's clear if
 * it was over its line, and nothing for the second (it had a start).
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
    const starts = timesOf(e.heldSince); // the model's (#469)
    if (e.state === 'crit' && e.word === WORDS.unreachable) {
      entries.push([node, hostEntry(false, levels, starts)]);
      continue;
    }
    if (!isObject(e.conditions)) {
      // No data: hold the entry, with the model's starts.
      if (before) {
        const kept = isObject(before.levels)
          ? hostEntry(before.reachable === true, levels, starts)
          : before;
        entries.push([node, kept]);
      }
      continue;
    }
    const readNow = new Set();
    for (const [reading, level] of Object.entries(e.conditions)) {
      if (!LEVELS.has(level)) continue;
      levels[reading] = level;
      readNow.add(reading);
    }
    const poolsRead = poolsOf(node).read;
    for (const reading of Object.keys(levels)) {
      if (readNow.has(reading) || Object.hasOwn(starts, reading)) continue;
      if (e.conditions[reading] === 'unknown') continue;
      if (reading.startsWith('pool:') && !poolsRead) continue;
      delete levels[reading]; // the model holds it no more
    }
    entries.push([node, hostEntry(true, levels, starts)]);
  }
  return sortedObject(entries);
}

/** A map of hold starts with only times in it (the model's `heldSince`, #469). */
function timesOf(map) {
  if (!isObject(map)) return {};
  return Object.fromEntries(Object.entries(map).filter(([, at]) => Number.isFinite(at)));
}

/** A host's entry: its levels, and when each held reading's hold began when it has any (#469). */
function hostEntry(reachable, levels, heldSince) {
  const kept = Object.entries(heldSince).filter(([reading]) => Object.hasOwn(levels, reading));
  const entry = { reachable, levels: sortedObject(Object.entries(levels)) };
  if (kept.length > 0) entry.heldSince = sortedObject(kept);
  return entry;
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
 * jump from mains to low battery still pages; anything else unknown.
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
 * A source's state after a cycle, from its state before it: ok when it
 * answered, failing on its first failed cycle, and down from its second in a
 * row (#292: one push, after about a minute, so a blip pages nothing).
 */
export function nextSourceState(before, failed) {
  if (!failed) return 'ok';
  return before === 'failing' || before === 'down' ? 'down' : 'failing';
}

/**
 * Each monitoring source the model lists, by nextSourceState. A source the
 * model doesn't list this cycle (the services payload is missing, so it can't
 * say) keeps its last state.
 *
 * The status check (#440): `status` is a model that built, so a run of failed
 * cycles is over. One that paged ("down") is "ok" for this cycle, which sends
 * its recovery; otherwise it is left out, so a board whose model builds has
 * only the monitoring sources here.
 *
 * services.yaml (#505, CONFIG_SOURCE): the model lists it only while the file
 * is no usable config, and always knows, so not listed means it loads. While
 * listed it steps like a monitoring source; then, like the status check, it
 * is "ok" for the one cycle after it paged and left out otherwise, so a good
 * file adds nothing here.
 */
export function buildSources(status, prevSources = {}) {
  const held = isObject(prevSources) ? prevSources : {};
  const listed = isObject(status?.sources) ? status.sources : {};
  const entries = [];
  // A source that is off (its URL unset or refused, #704) is not down: nothing to page.
  const offIssues = Array.isArray(status?.issues) ? status.issues : [];
  const isOff = (name) => offIssues.some((i) => i?.id === `sources/${name}` && i.word === 'Off');
  for (const name of MONITORING_SOURCES) {
    const before = Object.hasOwn(held, name) ? held[name] : undefined;
    const s = listed[name];
    if (!isObject(s)) {
      if (before !== undefined) entries.push([name, before]);
      continue;
    }
    entries.push([name, nextSourceState(before, s.state === 'failed' && !isOff(name))]);
  }
  const config = listed[CONFIG_SOURCE];
  if (isObject(config))
    entries.push([CONFIG_SOURCE, nextSourceState(held[CONFIG_SOURCE], config.state === 'failed')]);
  else if (held[CONFIG_SOURCE] === 'down') entries.push([CONFIG_SOURCE, 'ok']);
  if (held[STATUS_CHECK] === 'down') entries.push([STATUS_CHECK, 'ok']);
  // A node blind to its drives: stepped like a monitoring source while the
  // model lists it, "ok" for the one cycle after it paged, and left out otherwise.
  for (const name of Object.keys(listed).filter((n) => n.startsWith(DRIVES_SOURCE)).sort()) {
    if (isObject(listed[name]))
      entries.push([name, nextSourceState(held[name], listed[name].state === 'failed')]);
  }
  for (const name of Object.keys(held).filter((n) => n.startsWith(DRIVES_SOURCE)).sort()) {
    if (!isObject(listed[name]) && held[name] === 'down') entries.push([name, 'ok']);
  }
  return sortedObject(entries);
}

/** A snapshot that knows nothing (a first run's), fresh each time. */
const nothingKnown = () => ({
  services: {},
  monitorOf: {},
  hosts: {},
  ups: { state: 'unknown' },
  cron: {},
  sources: {},
});

/**
 * The snapshot of a cycle whose status model threw (#440): `prev` as it is,
 * so nothing is diffed, sent or lost for what the model judges, and the next
 * cycle it builds diffs against the last good state; only the status check's
 * own run of failed cycles moves on (nextSourceState), in `sources`, so its
 * second failed cycle in a row pages once, and the file keeps that across a
 * restart. It reads nothing of the model, which has no output. With no
 * `prev` (a first run), nothing is known of anything else either.
 *
 * @param {object|null} prev
 * @returns {object}
 */
export function modelFailedSnapshot(prev) {
  const base = isObject(prev) ? prev : nothingKnown();
  const held = isObject(base.sources) ? base.sources : {};
  const state = nextSourceState(held[STATUS_CHECK], true);
  return { ...base, sources: sortedObject(Object.entries({ ...held, [STATUS_CHECK]: state })) };
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
  const tempNames = buildTempNames(status, prev?.tempNames, ok.prometheus);
  // The nodes whose read failed: the services assembly draws no Missing card for them (#800).
  const unreadNodes = new Set(
    Object.entries(isObject(servicesCache?.nodes) ? servicesCache.nodes : {})
      .filter(([, node]) => Array.isArray(node?.failedReads) && node.failedReads.length > 0)
      .map(([key]) => key)
  );
  const missing = buildMissing(status, prev?.missing, ok.prometheus && internal?.presenceKnown !== false, unreadNodes);
  const containerConditions = buildContainerConditions(
    status,
    prev?.containerConditions,
    caches.getCached('containerEvents')
  );
  return {
    services: kept.services,
    monitorOf: kept.monitorOf,
    hosts: prev ? keepHosts(prev.hosts ?? {}, hosts, ok) : hosts,
    ups: ups ?? (prev && !ok.ups ? (prev.ups ?? { state: 'unknown' }) : { state: 'unknown' }),
    cron: buildCron(status, prev?.cron),
    sources: buildSources(status, prev?.sources),
    // Only while there is one, so a board with none keeps the snapshot it had.
    ...(Object.keys(tempNames).length > 0 ? { tempNames } : {}),
    ...(Object.keys(missing).length > 0 ? { missing } : {}),
    ...(Object.keys(containerConditions).length > 0 ? { containerConditions } : {}),
  };
}

/**
 * The snapshot of one push cycle (refresh.js runStatusAndPush): built from the
 * cycle's status model (buildSnapshot), or, when the model threw and there is
 * no status, `prev` with the status check's failed cycle (modelFailedSnapshot).
 *
 * @param {{ getCached: (key: string) => *, getCachedInternal?: (key: string) => * }} caches
 * @param {object|null} prev
 * @param {any} status  this cycle's status model, or null when it threw
 * @returns {object}
 */
export function cycleSnapshot(caches, prev, status) {
  return status ? buildSnapshot(caches, prev, status) : modelFailedSnapshot(prev);
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
 * memory at boot beside heldLevels (status/index.js memoryFromLevels): the
 * starts the model served and the snapshot copied, back to the model, so a
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
