/**
 * Background refresh loop and per-domain refresh functions.
 *
 * Refresh functions populate the in-memory cache used by the API routes. They
 * run on a configurable interval (default 30s) and are also called as cold-start
 * fallbacks by routes whose cache hasn't been populated yet.
 *
 * Loop control: startBackgroundRefresh() starts the interval (once at boot);
 * restartBackgroundRefresh() re-reads the interval from display-config and
 * restarts it (called after a settings save). Each tick also follows a hand
 * edit of the interval in the file.
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';

import { getConfig } from './config.js';
import { getNodesData, promQuery, NODE_READS } from './discovery.js';
import { recordSamples } from './history.js';
import {
  fetchMonitors,
  assignMonitors,
  checkMonitorMappings,
  logUnmatchedContainers,
  mappingOf,
  selectUnclaimedMonitors,
} from './monitors.js';
import { serviceRegistry } from './serviceRegistry.js';
import { containerRegistry } from './containerRegistry.js';
import { fetchIntegration } from './integrations/handler.js';
import { setCache } from './cache.js';
import { safeFetch } from './httpClient.js';
import { dedupe } from './util/dedupe.js';
import { isJobContainer } from './util/helperContainers.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { createSourceHealthLog } from './util/sourceHealthLog.js';
import { recordRefreshCycle } from './metrics.js';
import { createPushSnapshot, runPushCycle } from './push/dispatch.js';
import { buildSnapshot, liveCaches } from './push/snapshot.js';
import { getPushStore } from './push/store.js';
import * as fcm from './push/fcm.js';

const log = createLogger('refresh');

// Same display-config.json the displayConfig route writes — honor JAGHELM_DATA_DIR.
const DISPLAY_CONFIG_PATH = join(DATA_DIR, 'display-config.json');
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_SECONDS = 10;

let bgRefreshTimer = null;
let bgRefreshIntervalMs = null; // the interval bgRefreshTimer runs at
let bgRefreshRunning = false;
let lastRefreshComplete = 0; // ms epoch of the last finished cycle (0 = never)

// ── Push pipeline wiring ─────────────────────────────────────────────────
// The prev cycle's snapshot is held in memory and persisted beside the other
// data/ stores when it changes, and on shutdown. Exported for that test.
export const pushSnapshot = createPushSnapshot({ path: join(DATA_DIR, 'push-snapshot.json'), logger: log });
const DEFAULT_PUSH_THRESHOLDS = { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 };

// ── Helpers ──────────────────────────────────────────────────────────────

// display-config.json is cached: the loop needs its refresh interval and push
// thresholds every cycle, and re-parsing the file each time was pure waste.
// Each read stats the file and parses it again only when its identity (mtime,
// size, inode) differs from the cached copy's. Any difference counts, not just
// a newer mtime: a save by rename brings a new inode, and a restore can set an
// older mtime. A hand edit therefore takes effect on the next cycle. The
// displayConfig POST route also invalidates the cache after a save.
let cachedDisplayConfig; // undefined: not read yet; null: missing or unreadable
let cachedDisplayConfigId = null; // the file identity cachedDisplayConfig was read from

export function invalidateDisplayConfigCache() {
  cachedDisplayConfig = undefined;
}

function displayConfigId() {
  try {
    const st = statSync(DISPLAY_CONFIG_PATH);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return null; // missing
  }
}

/** The parsed display-config.json, or null on missing/error. */
function readDisplayConfig() {
  const id = displayConfigId();
  if (cachedDisplayConfig !== undefined && id === cachedDisplayConfigId) return cachedDisplayConfig;
  cachedDisplayConfigId = id;
  cachedDisplayConfig = null;
  if (id === null) return null;
  try {
    cachedDisplayConfig = JSON.parse(readFileSync(DISPLAY_CONFIG_PATH, 'utf8'));
  } catch (err) {
    // Once per bad file: it is parsed again only when it changes.
    log.warn({ err }, 'display-config.json is unreadable; using the default refresh interval and push thresholds');
  }
  return cachedDisplayConfig;
}

// Thresholds come from display-config when present, else the defaults.
export function getPushThresholds() {
  const data = readDisplayConfig();
  const t = data?.pushThresholds;
  if (t && typeof t === 'object') {
    return {
      cpu: typeof t.cpu === 'number' ? t.cpu : DEFAULT_PUSH_THRESHOLDS.cpu,
      mem: typeof t.mem === 'number' ? t.mem : DEFAULT_PUSH_THRESHOLDS.mem,
      disk: typeof t.disk === 'number' ? t.disk : DEFAULT_PUSH_THRESHOLDS.disk,
      hysteresis: typeof t.hysteresis === 'number' ? t.hysteresis : DEFAULT_PUSH_THRESHOLDS.hysteresis,
    };
  }
  return DEFAULT_PUSH_THRESHOLDS;
}

function formatContainerName(name) {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRefreshIntervalMs() {
  const data = readDisplayConfig();
  const seconds = data?.refreshInterval;
  if (typeof seconds === 'number' && seconds >= MIN_INTERVAL_SECONDS) return seconds * 1000;
  return DEFAULT_INTERVAL_MS;
}

const reportPrometheus = createSourceHealthLog('prometheus', log);

// Whether Prometheus has answered with an `up` series for some node since boot.
// After that, an answer with none for any node is a Prometheus that has just
// started and not scraped yet, not every host going down (#232).
let upSeriesSeen = false;

// ── Domain refresh functions ─────────────────────────────────────────────

/**
 * Build the unified /api/services payload: node metrics, container stats,
 * Kuma monitor health, and config overrides — merged into one structure.
 */
export async function refreshServices() {
  return dedupe('services', _refreshServices);
}

/**
 * Rank for the canonical per-node sort: down → unknown → up. Both frontends
 * inherit this order (web renders in array order, mobile re-sorts identically).
 */
function serviceRank(s) {
  if (s.status === 'down') return 0;
  if (s.status === 'unknown') return 1;
  return 2;
}

/**
 * Pure assembly of the services cache payload from discovered node data, Kuma
 * monitors, and the container presence registry. Extracted from _refreshServices
 * so it can be unit-tested without the network.
 *
 * Monitors are matched to containers once for the whole cycle
 * (assignMonitors, #240): a monitor marks one container unless services.yaml
 * maps it explicitly to several (`monitor`, `monitor_per_node`). The containers
 * that compete for monitors are the running ones on the board, and the ones
 * that stopped in the last 24 hours (the container registry's missing ones,
 * from the moment they stop, until JAGHELM_PRESENCE_TTL_MS): a down monitor
 * whose container stopped stays with it while it is the better match, so its
 * outage shows on that container's card, not on a lookalike's. Once the monitor
 * is up, a running container can have it. CI job containers are left out, as
 * discovery leaves them out (util/helperContainers.js), including the ones the
 * container registry recorded before that. `lastSeenNodeOf` /
 * `lastSeenContainerOf` place outage cards.
 *
 * Three passes:
 *  (a) Running-container cards — Kuma overlays the status of the monitor the
 *      container got; each running container is recorded into the container
 *      registry (last-seen node + timing). A name running on several nodes
 *      (cadvisor, alloy...) is recorded once, with the last node in the pass,
 *      and so is an explicitly mapped monitor in `seen`: recording each
 *      sighting flipped the node within every pass and rewrote the registries
 *      every cycle. The containers of a node are taken in name order, so `seen`
 *      does not depend on the order discovery listed them in.
 *  (b) Monitors no running container got — each active one reporting `down`
 *      or `up` is placed (placeMonitor): on the node of the stopped container
 *      that got the monitor, under its name; otherwise on the monitor's
 *      last-seen node, under the container it was last matched to (base spec).
 *      A uid is never one a card already on the node has, or one a monitor
 *      placed earlier in the pass took: a monitor whose last container still
 *      runs there, matched to something else now, is under the monitor's name.
 *      A down one becomes a red card. An up one draws nothing on the board; its
 *      uid goes in `upWithoutCard`, which the push snapshot reads as up, so the
 *      monitor's recovery is sent on the uid of its down push (#390).
 *  (c) Breadcrumb synthesis — established, UNMONITORED containers that have
 *      vanished (absent past grace, within TTL) become grey `unknown`
 *      `source:'presence'` cards on their last-seen node. Skipped if the
 *      container is running anywhere this cycle, if it got a (down) monitor in
 *      the matching (Kuma owns it: its outage is the monitor's red card), or if
 *      it is a CI job's. Skipped altogether when `presenceKnown` is false: a
 *      Prometheus query failed this cycle, so a container missing from the list
 *      may still be running, and a missed breadcrumb beats a false one (#232).
 *
 * Each node carries `reachable` from discovery (Prometheus' `up` for the node:
 * true, false, or null when Prometheus has no `up` series for it), and
 * `failedReads`: the parts of the node whose queries failed this cycle
 * (discovery's NODE_READS names; [] when they all answered). The push snapshot
 * keeps its previous value for each of those.
 *
 * Every node's cards are ordered down → unknown → up.
 *
 * Finally it computes ONE `overallHealth` from the whole assembled board (after
 * sorting) — `down` if any card is down; else `degraded` if any card is unknown
 * (presence breadcrumbs included); else `up` if there are cards; else `unknown`.
 * BOTH frontends read this single server value for their global dot, so they are
 * symmetric and deterministic (no client re-derivation).
 *
 * `unmatched` (unique names of the shown, running containers that got no
 * monitor on any node, leaving out those opted out with `monitor: false`) and
 * `containerCount` (how many shown, running containers there were) feed the
 * once-per-boot "no matching monitor" log line.
 *
 * @returns {{ nodes: object, seen: Array<{monitorId:any, nodeKey:string, container:string}>, outageCount: number, breadcrumbCount: number, overallHealth: 'down'|'degraded'|'up'|'unknown', unmatched: string[], containerCount: number, upWithoutCard: string[] }}
 */
export function assembleServices({ nodeResults, monitors, config, lastSeenNodeOf, lastSeenContainerOf, containerRegistry, now = Date.now, presenceKnown = true }) {
  const consumed = new Set();
  const seen = new Map(); // monitor id -> { monitorId, nodeKey, container }, last in the pass
  const runningOn = new Map(); // container name -> the last node it runs on in this pass
  const nowMs = now();
  const entries = nodeResults.filter(Boolean);
  const nodeOrder = entries.map(([nodeKey]) => nodeKey);

  // The shown, running containers of each node, in name order.
  const shown = entries.map(([nodeKey, nodeCfg, nodeData]) => {
    const hideList = (nodeCfg.hide || []).map((h) => h.toLowerCase());
    const containers = nodeData.containers
      .filter((c) => !hideList.some((h) => c.container.toLowerCase().includes(h)))
      .sort((a, b) => (a.container < b.container ? -1 : a.container > b.container ? 1 : 0));
    for (const c of containers) runningOn.set(c.container, nodeKey);
    return containers;
  });
  const containerCount = shown.reduce((n, containers) => n + containers.length, 0);

  // Containers that stopped in the last 24 hours compete for down monitors too.
  const stopped = containerRegistry
    ? containerRegistry
        .getMissing({ now: nowMs, graceMs: 0 })
        .filter((v) => !runningOn.has(v.container) && !isJobContainer(v.container))
        .sort((a, b) => (a.container < b.container ? -1 : a.container > b.container ? 1 : 0))
    : [];

  // Warns once per bad mapping; with no nodes in the config, it can't tell.
  const configNodeKeys = Object.keys(config.nodes || {});
  checkMonitorMappings(config.services, configNodeKeys.length ? configNodeKeys : null);
  const running = shown.flatMap((containers, n) => containers.map((c) => ({ container: c.container, nodeKey: nodeOrder[n] })));
  const assigned = assignMonitors({
    candidates: [...running, ...stopped.map((v) => ({ container: v.container, nodeKey: v.lastSeenNode, stopped: true }))],
    monitors,
    services: config.services,
    nodeOrder,
  });

  // The stopped containers that got a (down) monitor: Kuma owns them.
  const stoppedOwner = new Map(); // monitor id -> the first stopped container that got it
  const ownedStopped = new Set();
  stopped.forEach((v, j) => {
    const m = assigned[running.length + j];
    if (!m) return;
    ownedStopped.add(v.container);
    if (!stoppedOwner.has(m.id)) stoppedOwner.set(m.id, v);
  });

  // (a) Running-container cards.
  const withMonitor = new Set(); // container names that got a monitor on some node
  let next = 0;
  const nodeEntries = entries.map(([nodeKey, nodeCfg, nodeData], n) => {
    const metrics = nodeData.metrics;
    const services = shown[n].map((c) => {
      const override = config.services?.[c.container] || {};
      const displayName = override.display_name || formatContainerName(c.container);
      const monitor = assigned[next++];
      if (monitor) {
        consumed.add(monitor.id);
        withMonitor.add(c.container);
        // Remember the container too, so a later outage's synth card can reuse
        // this exact uid (keeps down→recovery on ONE key for the push differ).
        seen.set(monitor.id, { monitorId: monitor.id, nodeKey, container: c.container });
      }
      const rawStatus = monitor?.status || c.status || 'unknown';
      // Normalise Docker's 'running' to the Kuma-aligned 'up' so the status
      // vocabulary is consistent across container and monitor cards.
      const status = rawStatus === 'running' ? 'up' : rawStatus;

      return {
        container: c.container,
        uid: `${nodeKey}:${c.container}`,
        display_name: displayName,
        icon: override.icon || null,
        status,
        monitored: !!monitor,
        ping: monitor?.ping || null,
        uptime24: monitor?.uptime24 || null,
        docker: c.docker,
        integration: null,
        source: 'container',
      };
    });

    return [
      nodeKey,
      {
        display_name: nodeCfg.display_name || nodeKey,
        subtitle: nodeCfg.subtitle || '',
        icon: nodeCfg.icon || '🖥',
        border_color: nodeCfg.border_color || '#6366f1',
        reachable: typeof nodeData.reachable === 'boolean' ? nodeData.reachable : null,
        failedReads: Array.isArray(nodeData.failedReads) ? nodeData.failedReads : [],
        metrics,
        services,
      },
    ];
  });

  const nodes = Object.fromEntries(nodeEntries);
  const nodeKeys = Object.keys(nodes);
  if (containerRegistry) {
    for (const [name, nodeKey] of runningOn) containerRegistry.recordSeen(name, nodeKey, nowMs);
  }
  // A container opted out with `monitor: false` has no monitor on purpose.
  const wantsMonitor = running.filter((r) => mappingOf(config.services, r.container, r.nodeKey)?.monitor !== false);
  const unmatched = [...new Set(wantsMonitor.map((r) => r.container))].filter((name) => !withMonitor.has(name));

  // (b) Monitors no running container got: down-monitor synthesis, and the up
  // entries of the push snapshot (#390). selectUnclaimedMonitors keeps only
  // monitors that are up or down, active, and FRESH (a paused monitor's
  // heartbeat goes stale and is excluded, so a retired-while-down service can't
  // leave a phantom red card or send a false recovery — `active` reads null on
  // real Kuma and can't be relied on). Each one gets its uid from placeMonitor,
  // in one pass whatever its status, so a monitor keeps its uid from down to up
  // while its last container isn't in the stopped list (#395: a stopped owner
  // only competes for a down monitor). A down one becomes a red card; an up one
  // draws nothing and is listed in `upWithoutCard`, which the push snapshot
  // reads as up, so its recovery is sent on the uid its down push had.
  const taken = new Set(nodeKeys.flatMap((k) => nodes[k].services.map((s) => s.uid)));
  const upWithoutCard = [];
  let outageCount = 0;
  for (const m of selectUnclaimedMonitors(monitors, consumed, { now: nowMs })) {
    if (m.status === 'down') outageCount += 1;
    const place = placeMonitor(m, { nodes, nodeKeys, taken, owner: stoppedOwner.get(m.id), lastSeenNodeOf, lastSeenContainerOf });
    if (!place) continue; // no nodes to attach to
    taken.add(place.uid);
    if (m.status === 'up') {
      upWithoutCard.push(place.uid);
      continue;
    }
    const { nodeKey, idPart, remembered } = place;
    const override = config.services?.[idPart] || {};
    nodes[nodeKey].services.push({
      container: idPart,
      uid: place.uid,
      display_name: override.display_name || (idPart === remembered ? formatContainerName(remembered) : m.name),
      icon: override.icon || null,
      status: 'down',
      monitored: true,
      ping: m.ping || null,
      uptime24: m.uptime24 || null,
      docker: null,
      integration: null,
      source: 'monitor',
    });
  }

  // (c) Breadcrumb synthesis — vanished, established, UNMONITORED containers.
  let breadcrumbCount = 0;
  if (containerRegistry && presenceKnown) {
    const candidates = containerRegistry.getMissing({ now: nowMs });
    for (const cand of candidates) {
      if (runningOn.has(cand.container)) continue;                // running somewhere this cycle
      if (isJobContainer(cand.container)) continue;               // a CI job, done
      // Kuma owns it: it got a down monitor in the matching, by its explicit
      // mapping or by name, so the outage shows as that monitor's red card.
      if (ownedStopped.has(cand.container)) continue;
      const override = config.services?.[cand.container] || {};
      let nodeKey = cand.lastSeenNode;
      if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
      if (!nodeKey || !nodes[nodeKey]) continue; // no nodes to attach to
      nodes[nodeKey].services.push({
        container: cand.container,
        uid: `${nodeKey}:${cand.container}`,
        display_name: override.display_name || formatContainerName(cand.container),
        icon: null,
        status: 'unknown',
        monitored: false,
        source: 'presence',
        lastSeenAt: cand.lastSeenAt,
        ping: null,
        uptime24: null,
        docker: null,
        integration: null,
      });
      breadcrumbCount += 1;
    }
  }

  // Canonical order per node: down → unknown → up, then alphabetical.
  for (const node of Object.values(nodes)) {
    node.services.sort((a, b) => serviceRank(a) - serviceRank(b) || a.display_name.localeCompare(b.display_name));
  }

  // Server-computed global health for BOTH frontends' dot (web NavBar + mobile
  // Overview). Computed ONCE from every assembled card across all nodes so the
  // two clients are symmetric and deterministic — a presence breadcrumb (status
  // 'unknown') drives 'degraded', exactly as a tracked-unknown monitor would.
  let anyCard = false;
  let anyDown = false;
  let anyUnknown = false;
  for (const node of Object.values(nodes)) {
    for (const s of node.services) {
      anyCard = true;
      if (s.status === 'down') anyDown = true;
      else if (s.status === 'unknown') anyUnknown = true;
    }
  }
  const overallHealth = anyDown ? 'down' : anyUnknown ? 'degraded' : anyCard ? 'up' : 'unknown';

  return {
    nodes,
    seen: [...seen.values()],
    outageCount,
    breadcrumbCount,
    overallHealth,
    unmatched: [...unmatched].sort(),
    containerCount,
    upWithoutCard,
  };
}

/**
 * Where a monitor no running container got goes, down or up (#390): its node
 * and the uid its card has, `{ nodeKey, idPart, uid, remembered }`, or null with
 * no node to attach to. Pass (b) of assembleServices is its only caller, for
 * both statuses, so a monitor's up entry has the uid its red card had while its
 * last container isn't in the stopped list (#395): `owner` is only ever set for
 * a down monitor.
 *
 * The node is that of the stopped container that got the (down) monitor
 * (`owner`), else the monitor's last-seen node, else the first node. The uid
 * reuses the container the monitor was last matched to (the owner, else the
 * service registry's), the uid its running card had, so a down→recovery
 * transition stays on ONE key: the push differ only emits a recovery when
 * 'down' and 'up' share a key. It falls back to the monitor's name for a
 * monitor that never had a container, or when the uid is `taken` (a running
 * container's card, or a monitor placed earlier in the pass), and then to the
 * name and id.
 */
function placeMonitor(m, { nodes, nodeKeys, taken, owner, lastSeenNodeOf, lastSeenContainerOf }) {
  let nodeKey = owner ? owner.lastSeenNode : lastSeenNodeOf(m.id);
  if (!nodeKey || !nodes[nodeKey]) nodeKey = nodeKeys[0];
  if (!nodeKey || !nodes[nodeKey]) return null;
  const remembered = owner ? owner.container : lastSeenContainerOf ? lastSeenContainerOf(m.id) : null;
  const free = (part) => !!part && !taken.has(`${nodeKey}:${part}`);
  const idPart = [remembered, m.name].find(free) || `${m.name} (${m.id})`;
  return { nodeKey, idPart, uid: `${nodeKey}:${idPart}`, remembered };
}

async function _refreshServices() {
  try {
    const config = getConfig();
    if (!config || !config.nodes || Object.keys(config.nodes).length === 0) {
      setCache('services', { nodes: {}, overallHealth: 'unknown' });
      return { nodes: {}, overallHealth: 'unknown' };
    }

    // Monitors are best-effort; if Kuma is down we still want node data.
    const monitorsSettled = fetchMonitors(true).catch((err) => {
      log.warn({ err }, 'monitors fetch failed');
      return { ok: false, monitors: {} };
    });
    // Every visible node is read in one batch, one query per reading across all
    // of them (#234). Should the batch throw, Kuma's result is still used, no
    // node is in the payload, and Prometheus counts as failed.
    const visibleNodes = Object.entries(config.nodes).filter(([, nodeCfg]) => nodeCfg.visible !== false);
    const promLabelOf = ([nodeKey, nodeCfg]) => nodeCfg.prometheus_node || nodeKey;
    const nodesSettled = getNodesData(visibleNodes.map(promLabelOf)).then(
      (byLabel) => ({ ok: true, byLabel }),
      (err) => ({ ok: false, err })
    );
    const [kuma, nodesOutcome] = await Promise.all([monitorsSettled, nodesSettled]);
    const monitors = kuma.monitors;

    // Prometheus failed this cycle if any query did: every node's `ok` is then
    // false, with the same `failedReads` naming what the failed queries feed.
    let nodeResults = [];
    const promErrors = [];
    if (nodesOutcome.ok) {
      for (const entry of visibleNodes) {
        const nodeData = nodesOutcome.byLabel.get(promLabelOf(entry));
        nodeResults.push([entry[0], entry[1], nodeData]);
      }
      const failed = [...nodesOutcome.byLabel.values()].find((nodeData) => nodeData.ok === false);
      if (failed) promErrors.push(failed.error);
    } else {
      const msg = nodesOutcome.err?.message || String(nodesOutcome.err);
      log.warn({ err: msg }, 'node refresh failed');
      promErrors.push(msg);
    }
    // Every query answered, but no node has an `up` series where an earlier
    // answer had some: a Prometheus that has just started (after an outage
    // longer than its lookback) and not scraped yet. Its empty answers say
    // nothing about the hosts, so the cycle counts as failed and every node's
    // reads as unread, until an `up` series is back.
    const answered = nodeResults.filter(Boolean);
    if (promErrors.length === 0 && answered.length > 0) {
      if (answered.some(([, , nodeData]) => typeof nodeData?.reachable === 'boolean')) {
        upSeriesSeen = true;
      } else if (upSeriesSeen) {
        promErrors.push('Prometheus answered, but with no up series for any node');
        nodeResults = nodeResults.map((r) => r && [r[0], r[1], { ...r[2], ok: false, failedReads: NODE_READS }]);
      }
    }
    const prometheusOk = promErrors.length === 0;
    reportPrometheus({ ok: prometheusOk, error: promErrors[0] });

    const { nodes, seen, overallHealth, unmatched, containerCount, upWithoutCard } = assembleServices({
      nodeResults,
      monitors,
      config,
      lastSeenNodeOf: (id) => serviceRegistry.getLastSeenNode(id),
      lastSeenContainerOf: (id) => serviceRegistry.getLastSeenContainer(id),
      containerRegistry,
      now: Date.now,
      presenceKnown: prometheusOk,
    });

    // Remember where each running, monitored service lives (and which container
    // it maps to) so an outage that later loses its container still lands on its
    // panel AND keeps the same uid for recovery detection.
    for (const { monitorId, nodeKey, container } of seen) serviceRegistry.recordSeen(monitorId, nodeKey, container);
    serviceRegistry.save();
    // containerRegistry was updated in-pass (recordSeen) inside assembleServices;
    // decommission-prune (>TTL) then persist here. prune() is an explicit refresh-loop
    // step (NOT a save() side effect) so persistence never silently deletes by clock.
    containerRegistry.prune();
    containerRegistry.save();

    // overallHealth is server-computed once (above) and shipped in the payload so
    // BOTH frontends' global dots read one truth (web NavBar + mobile Overview).
    // `sources` says whether each upstream answered this cycle (#232): the push
    // snapshot keeps its last state for one that didn't, so a failed poll is not
    // read as every host or service going down. `upWithoutCard`, the uids of
    // the up monitors no card is drawn for (#390), is for the push snapshot
    // only, so it is kept beside the payload, not in the served JSON.
    const sources = { prometheus: { ok: prometheusOk }, kuma: { ok: kuma.ok } };
    const result = { nodes, overallHealth, sources };
    setCache('services', result, { upWithoutCard });

    // Record this cycle's usage into the ring buffer so the UI can draw a
    // glance-context sparkline. Only the bounded usage percents (CPU/RAM/disk);
    // non-finite values are skipped inside history.js.
    for (const [nodeKey, node] of Object.entries(nodes)) {
      const m = node.metrics || {};
      recordSamples({
        [`${nodeKey}:cpu`]: m.cpu,
        [`${nodeKey}:mem`]: m.memPercent,
        [`${nodeKey}:disk`]: m.diskPercent,
      });
    }

    logUnmatchedContainers({ unmatched, containerCount, monitors });
    return result;
  } catch (err) {
    log.error({ err }, 'services refresh error');
    return null;
  }
}

/** UPS battery, charge, runtime, load — sourced from NUT via Prometheus. */
export async function refreshUPS() {
  return dedupe('ups', _refreshUPS);
}

// The NUT exporter series each UPS payload field reads.
const UPS_METRICS = {
  status: 'nut_status',
  charge: 'nut_battery_charge',
  runtime: 'nut_battery_runtime_seconds',
  load: 'nut_load',
};

// A UPS whose exporter has gone quiet still counts as set up for this long.
const UPS_SEEN_WITHIN = '7d';

// The UPS readings, plus the exporter's info series as last seen within
// UPS_SEEN_WITHIN: one query (#234).
const UPS_QUERY =
  `{__name__=~"${Object.values(UPS_METRICS).join('|')}",ups="apcups"}` +
  ` or last_over_time(nut_ups_info{ups="apcups"}[${UPS_SEEN_WITHIN}])`;

/**
 * The payload is `{ status, charge, runtime, load, ok, configured, model }`,
 * read with one query (#234). A value is null when Prometheus has no series for
 * it (no UPS, or its exporter is quiet) or the query failed; `ok` is false when
 * it failed (#232), so the push snapshot keeps the last UPS state instead of
 * reading the failure as "unknown". A Prometheus outage is logged by the
 * services refresh, which queries the same Prometheus every cycle.
 *
 * `configured` says whether this install has a UPS (#272): true when a reading
 * is there now or the exporter's info series was seen within UPS_SEEN_WITHIN,
 * false when neither, null when the query failed (not known). The dashboard
 * shows the UPS panel by it. `model` is the UPS's description or model from
 * that info series, or null. Nothing else from its labels is sent: they also
 * carry the exporter's address, the driver and USB ids.
 */
async function _refreshUPS() {
  try {
    let series = null;
    try {
      series = await promQuery(UPS_QUERY);
    } catch (err) {
      log.debug({ err }, 'UPS read failed');
    }

    const results = {};
    for (const [k, name] of Object.entries(UPS_METRICS)) {
      const raw = series?.find((r) => r.metric?.__name__ === name)?.value?.[1];
      let val = raw != null ? parseFloat(raw) : null;
      if (val !== null && (k === 'charge' || k === 'load')) val = val * 100;
      results[k] = val;
    }
    // Found by its labels, not its name: older Prometheus versions drop the
    // name in last_over_time.
    const info = series?.find((r) => r.metric?.description || r.metric?.model)?.metric;
    results.ok = series !== null;
    results.configured =
      series === null ? null : Object.keys(UPS_METRICS).some((k) => results[k] !== null) || Boolean(info);
    results.model = info?.description || info?.model || null;
    setCache('ups', results);
    return results;
  } catch (err) {
    log.error({ err }, 'UPS refresh error');
    return null;
  }
}

/** Recent commits across all Gitea repos (auto-discovers via /api/v1/repos/search). */
export async function refreshGitea() {
  return dedupe('gitea', _refreshGitea);
}

// What /api/gitea/activity answers when no Gitea is set up (#272): the
// dashboard hides its Pipeline panel. Frozen: it is cached and served as is.
const GITEA_NOT_CONFIGURED = Object.freeze({ configured: false });

/** Whether a Gitea is set up: GITEA_URL is set (#249 adds the JAGHELM_ name). */
function giteaConfigured() {
  return Boolean(process.env.GITEA_URL);
}

/**
 * The payload is the repos with recent commits, newest first, or
 * GITEA_NOT_CONFIGURED when GITEA_URL is not set, which polls nothing. null
 * (nothing cached) when Gitea failed, so the route answers 502.
 */
async function _refreshGitea() {
  if (!giteaConfigured()) {
    setCache('gitea', GITEA_NOT_CONFIGURED);
    return GITEA_NOT_CONFIGURED;
  }
  try {
    const url = process.env.GITEA_URL;
    const token = process.env.GITEA_TOKEN || '';
    // Header, not ?token= — Gitea logs full request URLs, which would leak it.
    const opts = token ? { headers: { Authorization: `token ${token}` } } : {};

    const reposRes = await safeFetch(`${url}/api/v1/repos/search?limit=20`, opts);
    const reposData = await reposRes.json();
    const repos = (reposData?.data || reposData || [])
      .filter((r) => !r.fork && !r.mirror && !r.archived)
      .map((r) => ({ name: r.name, fullName: r.full_name }));

    if (repos.length === 0) {
      setCache('gitea', []);
      return [];
    }

    const repoCommits = await Promise.allSettled(
      repos.map(async (repo) => {
        const commitsRes = await safeFetch(
          `${url}/api/v1/repos/${repo.fullName}/commits?limit=5&sha=main`,
          opts
        );
        const data = await commitsRes.json();
        const commits = Array.isArray(data)
          ? data.map((c) => ({
              sha: c.sha?.substring(0, 7),
              message: c.commit?.message?.split('\n')[0] || '',
              date: c.commit?.author?.date || '',
              author: c.commit?.author?.name || '',
            }))
          : [];
        return { repo: repo.name, fullName: repo.fullName, commits };
      })
    );

    const result = repoCommits
      .filter((r) => r.status === 'fulfilled' && r.value.commits.length > 0)
      .map((r) => r.value)
      .sort((a, b) => {
        const aDate = a.commits[0]?.date || '';
        const bDate = b.commits[0]?.date || '';
        return new Date(bDate) - new Date(aDate);
      });

    setCache('gitea', result);
    return result;
  } catch (err) {
    log.error({ err }, 'Gitea refresh error');
    return null;
  }
}

/** Aggregate data from every configured integration (presets + custom). */
export async function refreshIntegrations() {
  return dedupe('integrations', _refreshIntegrations);
}

async function _refreshIntegrations() {
  try {
    const config = getConfig();
    const integrations = config?.integrations || {};

    const results = {};
    const entries = Object.entries(integrations).filter(([, cfg]) => cfg.enabled !== false);

    const fetchOne = async ([key, cfg]) => {
      try {
        const handlerType = cfg.preset || key;
        const result = await fetchIntegration(handlerType, { ...cfg, _storageKey: key });
        const entry = { ...(result.fields || {}) };
        // Surface fetch/auth failures instead of dropping them — otherwise a
        // down integration renders as silent zeros, not an error state.
        if (result.error) entry._error = result.error;
        if (result.vms) entry._vms = result.vms;
        if (result.storagePools) entry._storagePools = result.storagePools;
        if (result.lastBackup) entry._lastBackup = result.lastBackup;
        if (cfg.target) entry._target = cfg.target;
        if (cfg.instance) entry._instance = cfg.instance;
        // Stamp the preset identity so the client can detect integration type
        // directly (e.g. proxmox child panels) rather than sniffing output fields.
        entry._preset = handlerType;
        results[key] = entry;
      } catch (err) {
        results[key] = { _error: String((err && err.message) || err) };
      }
    };

    // Bounded fan-out: a fully-wired board can have 30-50+ integrations; firing them
    // all at once opened that many concurrent sockets every refresh cycle. Cap the
    // peak (no head-of-line blocking — runners pull from a shared queue).
    const CONCURRENCY = 6;
    const queue = [...entries];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) await fetchOne(queue.shift());
      })
    );
    setCache('integrations', results);
    return results;
  } catch (err) {
    log.error({ err }, 'integrations refresh error');
    return null;
  }
}

// ── Background loop ──────────────────────────────────────────────────────

// A cycle this slow logs at info: half the shortest interval allowed
// (MIN_INTERVAL_SECONDS), so it fires before a cycle can overrun any cadence.
// A healthy cycle takes well under a second, so this catches only outliers.
const SLOW_CYCLE_MS = (MIN_INTERVAL_SECONDS * 1000) / 2;

// The refreshes one background cycle runs, each with the name it goes by in the
// cycle's error set. One list, so a name can't drift from its function.
export const CYCLE_REFRESHES = [
  ['services', refreshServices],
  ['ups', refreshUPS],
  ['gitea', refreshGitea],
  ['integrations', refreshIntegrations],
];

/**
 * Run the refreshes in parallel and return the cycle's error set: the name of
 * every refresh that failed (each returns null after logging its own error) and
 * `integration:<key>` for every integration that came back with an `_error`.
 * Keys only, not messages, so an error whose text varies doesn't read as a
 * change. Sorted.
 */
export async function runCycleRefreshes(refreshes = CYCLE_REFRESHES) {
  const settled = await Promise.allSettled(refreshes.map(([, fn]) => fn()));
  const errors = [];
  settled.forEach((r, i) => {
    const name = refreshes[i][0];
    if (r.status === 'rejected' || r.value == null) {
      errors.push(name);
      return;
    }
    if (name === 'integrations') {
      for (const [key, entry] of Object.entries(r.value)) {
        if (entry && entry._error) errors.push(`integration:${key}`);
      }
    }
  });
  return errors.sort();
}

/**
 * Logs one line per background cycle, at debug in steady state. At info only
 * when the cycle was slow (`slow: true`), or when its error set differs from the
 * previous cycle's (`added` / `cleared`): a new failure, or a recovery when the
 * set empties. A failure that persists stays quiet here; its own refresh
 * function keeps logging it.
 */
export function createCycleReporter(logger = log) {
  let prevErrors = [];
  return function reportCycle({ ms, errors }) {
    const current = [...new Set(errors)].sort();
    const added = current.filter((e) => !prevErrors.includes(e));
    const cleared = prevErrors.filter((e) => !current.includes(e));
    prevErrors = current;
    const slow = ms >= SLOW_CYCLE_MS;
    const changed = added.length > 0 || cleared.length > 0;
    const fields = { ms, errors: current };
    if (slow) fields.slow = true;
    if (changed) Object.assign(fields, { added, cleared });
    (slow || changed ? logger.info : logger.debug)(fields, 'background cycle complete');
  };
}

const reportCycle = createCycleReporter();

async function runBackgroundRefresh() {
  // Follow a hand edit of the interval in display-config.json from this tick on.
  const intervalMs = getRefreshIntervalMs();
  if (bgRefreshTimer && intervalMs !== bgRefreshIntervalMs) {
    scheduleBackgroundRefresh(intervalMs);
    log.info({ intervalSec: intervalMs / 1000 }, 'background loop restarted (refresh interval changed)');
  }
  if (bgRefreshRunning) return; // Skip if previous cycle hasn't finished
  bgRefreshRunning = true;
  const start = Date.now();
  let ok = true;
  try {
    const errors = await runCycleRefreshes();
    reportCycle({ ms: Date.now() - start, errors });

    // Push cycle: diff this cycle's state vs the last and notify mobile
    // tokens. Self-contained — it can NEVER reject (see runPushCycle), so it
    // cannot flip `ok` or break the loop. No-ops when push is disabled.
    await runPushCycle({
      buildSnapshotFn: (prev) => buildSnapshot(liveCaches, prev),
      store: getPushStore(),
      fcm,
      snapshot: pushSnapshot,
      thresholds: getPushThresholds(),
      logger: log,
    });
  } catch (err) {
    ok = false;
    log.error({ err }, 'background cycle error');
  } finally {
    bgRefreshRunning = false;
    lastRefreshComplete = Date.now();
    recordRefreshCycle(Date.now() - start, ok);
  }
}

/**
 * Liveness of the background refresh loop, for /api/health (which the Docker
 * HEALTHCHECK + deploy verify gate trust). 'starting' before the first cycle,
 * 'stale' once the loop has missed ~3 expected cycles (wedged), else 'ok'.
 */
export function getRefreshHealth() {
  if (lastRefreshComplete === 0) return { state: 'starting', ageMs: null };
  const ageMs = Date.now() - lastRefreshComplete;
  // The interval the timer runs at: a hand edit is in the file before the
  // timer's next tick picks it up.
  const intervalMs = bgRefreshIntervalMs ?? getRefreshIntervalMs();
  const state = ageMs > Math.max(3 * intervalMs, 90_000) ? 'stale' : 'ok';
  return { state, ageMs };
}

function scheduleBackgroundRefresh(intervalMs) {
  if (bgRefreshTimer) clearInterval(bgRefreshTimer);
  bgRefreshTimer = setInterval(runBackgroundRefresh, intervalMs);
  bgRefreshIntervalMs = intervalMs;
}

export function startBackgroundRefresh() {
  const intervalMs = getRefreshIntervalMs();
  scheduleBackgroundRefresh(intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop started');
  // Once per boot, not per cycle: without GITEA_URL nothing is polled and the
  // dashboard has no Pipeline panel, which a deploy check can see here.
  if (!giteaConfigured()) log.info('Gitea panel off: GITEA_URL is not set');
  // Warm the cache immediately so the first dashboard load isn't a cold miss
  runBackgroundRefresh();
}

export function restartBackgroundRefresh() {
  // The cached display config is stale by definition when this is called (the
  // route that triggers a restart just wrote a new value).
  invalidateDisplayConfigCache();
  const intervalMs = getRefreshIntervalMs();
  scheduleBackgroundRefresh(intervalMs);
  log.info({ intervalSec: intervalMs / 1000 }, 'background loop restarted');
}

/**
 * Stop the background loop. Called on shutdown so the timer doesn't fire
 * mid-drain. Also writes what the loop holds in memory ahead of the files: the
 * container registry's refreshed lastSeenAt (up to PRESENCE_FLUSH_MS old on
 * disk) and the push snapshot's latest readings (see createPushSnapshot).
 */
export function stopBackgroundRefresh() {
  if (bgRefreshTimer) {
    clearInterval(bgRefreshTimer);
    bgRefreshTimer = null;
    bgRefreshIntervalMs = null;
  }
  containerRegistry.flush();
  pushSnapshot.flush();
}
