/**
 * Test-only builders for the status model's inputs (server/status/, #290):
 * what the refreshes cache, shaped as they cache it, with healthy defaults, so
 * a test states only what it is about.
 */
import { buildStatus } from '../status/model.js';
import { DEFAULT_THRESHOLDS } from '../status/thresholds.js';

export const NOW = 1_782_345_600_000;
export const CYCLE_MS = 30_000;

/** A node of the /api/services payload: reachable, every reading in range. */
export function node(metrics = {}, extra = {}) {
  return {
    display_name: extra.display_name ?? 'Node',
    reachable: true,
    failedReads: [],
    metrics: { cpu: '10.0', memPercent: '40.0', diskPercent: '50.0', temp: '45.0', ...metrics },
    services: [],
    ...extra,
  };
}

/** A card of the /api/services payload: a running container with no monitor. */
export function card(uid, extra = {}) {
  const container = uid.slice(uid.indexOf(':') + 1);
  return {
    uid,
    container,
    display_name: container,
    status: 'up',
    monitored: false,
    source: 'container',
    ...extra,
  };
}

/** A running container whose Kuma monitor reports `status`. */
export function monitored(uid, status = 'up', extra = {}) {
  return card(uid, { status, monitored: true, ...extra });
}

/** A grey presence card: a container that stopped. */
export function missing(uid, lastSeenAt = NOW - 600_000, extra = {}) {
  return card(uid, { status: 'unknown', source: 'presence', lastSeenAt, ...extra });
}

export const UPS_ONLINE = Object.freeze({
  status: 1,
  charge: 100,
  runtime: 3600,
  load: 20,
  ok: true,
  configured: true,
  model: 'Back-UPS',
});
export const NO_UPS = Object.freeze({
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: true,
  configured: false,
  model: null,
});

/**
 * The model's inputs for one cycle. `nodes` is the payload's node map; the
 * rest default to a healthy install with a UPS and nothing else.
 */
export function inputs({
  nodes = { n1: node() },
  internal = {},
  prometheusOk = true,
  kumaOk = true,
  services,
  ups = UPS_ONLINE,
  integrations = {},
  cron = [],
  ...rest
} = {}) {
  return {
    services:
      services === undefined
        ? {
            nodes,
            overallHealth: 'up',
            sources: { prometheus: { ok: prometheusOk }, kuma: { ok: kumaOk } },
          }
        : services,
    servicesInternal: internal,
    ups,
    integrations,
    cron,
    ...rest,
  };
}

/**
 * Runs the model over consecutive cycles, one `inputs` each, CYCLE_MS apart
 * from NOW, carrying its memory. Returns each cycle's status.
 */
export function cycles(list, { thresholds = DEFAULT_THRESHOLDS, start = NOW } = {}) {
  let memory = null;
  return list.map((cycleInputs, i) => {
    const built = buildStatus({
      inputs: cycleInputs,
      thresholds,
      memory,
      now: start + i * CYCLE_MS,
    });
    memory = built.memory;
    return built.status;
  });
}

/** One cycle's status. */
export function once(cycleInputs, opts) {
  return cycles([cycleInputs], opts)[0];
}

/** The entity with `id`, or undefined. */
export function entityOf(status, id) {
  return status.entities.find((e) => e.id === id);
}

/** A cron store entry: one node's jobs, each with its latest run. */
export function cronNode(nodeName, jobs) {
  return {
    node: nodeName,
    jobs: Object.entries(jobs).map(([job, run]) => ({ job, runs: run ? [run] : [] })),
  };
}

/** A cron run `agoMs` before NOW. */
export function cronRun(status, agoMs = 60_000, extra = {}) {
  return { status, timestamp: new Date(NOW - agoMs).toISOString(), ...extra };
}
