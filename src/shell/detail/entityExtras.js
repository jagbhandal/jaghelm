/**
 * What an entity's detail shows beyond the model's word and reason (#310,
 * spec §8): the desktop's drawer and the phone's detail sheet (web look) both
 * draw it, from the same reads. The model judges every state (spec §6); this
 * only adds numbers and names from the reads the status doesn't carry:
 *
 *   node        its readings as meters (the Infrastructure card's, #299:
 *               the model's level for each, the served lines), its uptime,
 *               memory and disk in units, and on a Proxmox node its virtual
 *               machines, its storage pools (meters on the disk rule, spec
 *               §6.1, coloured by the model's level for each pool) and its
 *               last backup                     /api/services, /api/integrations
 *   service,    its latency and 24 h uptime (while it is up, as its row),
 *   container   when it was last seen, its node; the container's CPU,
 *               memory and network rates while it runs; the stats of the
 *               integration that matches it (the Services rows' matching,
 *               #300)                           /api/services, /api/integrations
 *   UPS         its charge, the runtime (left, on battery; at this load, on
 *               mains), its load and model      the model alone (#586)
 *   integration its stats, or why its last read failed       /api/integrations
 *   job, backup its schedule in words and when it last reported (the
 *               model's, #578), the overdue line while it is overdue, and
 *               its last runs: when, how long, the error /api/cron/status
 *   agent, source  the model's word and reason alone
 *
 * `sourcesFor` names the reads a kind needs, which useDetailSources makes
 * while the detail is open; /api/integrations only when the model has an
 * integration at all; /api/cron/status as a job's detail opens, and again
 * only when the model says it reported since. Its Remove is the detail's
 * (JobRemove.jsx). A read that failed keeps what it last had, and says so
 * (`unread`). With a stale status, every meter is drawn as no signal
 * (drawnState), as the Overview draws them, the facts greyed as last known
 * (`lastKnown`), and no runtime: it counts down.
 */
import { readingLines, shownReading } from '../../../server/status/readings.js';
import { agoText } from '@ui/lib/ago.js';
import { lastSeenLabel } from '../../util/relativeTime.js';
import { FRESH, upsReadingsOf } from '../../phone/data/board.js';
import { uptimePct } from '../../phone/data/derive.js';
import { appEntryOf, integrationClaims } from '../useAppDataMatching.js';
import { infrastructureNodes } from '../infrastructureView.js';
import { drawnState } from '../statusFreshness.js';
import { proxmoxEntryFor } from './proxmox.js';
import { cronEntryOf, lastReportAgo, overdueLine, runsOf } from './jobRuns.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** What each read is, as a sentence names it. */
export const SOURCE_WORDS = Object.freeze({
  services: 'the node and container readings',
  integrations: "the integrations' stats",
  cron: "the job's last runs",
});

/**
 * The reads `entity` needs beyond the status, in a fixed order: [] for one
 * the model alone describes, or none (the drawer closed, an id it hasn't).
 *
 * @param {any} entity  the model's
 * @param {any} status
 * @returns {string[]}
 */
export function sourcesFor(entity, status) {
  if (!entity) return [];
  const integrations = (status?.entities ?? []).some((e) => e.kind === 'integration');
  const withStats = integrations ? ['services', 'integrations'] : ['services'];
  switch (entity.kind) {
    case 'node':
    case 'service':
    case 'container':
      return withStats;
    case 'integration':
      return ['integrations'];
    case 'job':
    case 'backup':
      return ['cron'];
    default:
      return [];
  }
}

/** Mebibytes as the old service card said them: "612.5 MB", "1.3 GB". */
export function memoryText(mb) {
  const n = num(mb);
  if (n == null) return null;
  return n < 1024 ? `${Math.round(n * 10) / 10} MB` : `${(n / 1024).toFixed(1)} GB`;
}

/** A network rate: "640 B/s", "12.4 KB/s", "1.1 MB/s". */
export function rateText(bytesPerSec) {
  const n = num(bytesPerSec);
  if (n == null) return null;
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
}

const fact = (key, label, value) => (value == null || value === '' ? null : { key, label, value });

/** /api/services' card for a service uid, with its node's name. */
function cardOf(services, uid) {
  for (const [nodeKey, node] of Object.entries(services?.nodes ?? {})) {
    for (const card of node?.services ?? []) {
      if (card?.uid === uid) return { card, nodeName: node.display_name || nodeKey };
    }
  }
  return null;
}

// ── Nodes ────────────────────────────────────────────────────────────────

const VM_STATUS = { running: 'Running', stopped: 'Stopped', paused: 'Paused' };

/** A Proxmox VM as the drawer lists it. */
function vmOf(vm, i) {
  const status = String(vm?.status ?? 'unknown');
  const cpus = num(vm?.maxcpu);
  const used = num(vm?.memUsedGB);
  const total = num(vm?.memTotalGB);
  return {
    key: String(vm?.vmid ?? i),
    name: String(vm?.name ?? `VM ${vm?.vmid ?? ''}`),
    status: VM_STATUS[status] ?? status.charAt(0).toUpperCase() + status.slice(1),
    running: status === 'running',
    detail: [
      cpus ? `${cpus} vCPU` : null,
      used != null && total ? `${vm.memUsedGB} / ${vm.memTotalGB} GB` : null,
      vm?.vmid != null ? `ID ${vm.vmid}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

// The levels the model gives a reading it read this cycle.
const JUDGED = new Set(['ok', 'warn', 'crit']);

/**
 * A storage pool's meter: valued from the integration, its state the model's
 * level for it (`pool:<name>` in the node's conditions), its lines the disk
 * rule's (spec §6.1). A pool the model holds with no reading this cycle, or
 * one with no size (an inactive pool's 0 % is no reading), has no value.
 */
function poolMeter(pool, entity, thresholds, freshness) {
  const name = String(pool?.name ?? '');
  const key = `pool:${name}`;
  const level = entity.conditions?.[key];
  const sized = (num(pool?.totalGB) ?? 0) > 0;
  const read = level === undefined || JUDGED.has(level);
  const value = sized && read ? num(pool?.percent) : null;
  return {
    key,
    label: name,
    value,
    unit: '%',
    max: 100,
    state: level == null ? null : drawnState(level, freshness),
    ...readingLines(thresholds, key),
    caption: [
      sized ? `${pool.usedGB} / ${pool.totalGB} GB` : null,
      pool?.type && pool.type !== 'unknown' ? pool.type : null,
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/**
 * The last vzdump batch: when it started (on the status's clock), its result
 * and how many VMs. Proxmox gives a task its status once it ends: one with
 * none (or "running") is still running, never failed.
 */
function backupFacts(backup, at) {
  if (!isObject(backup)) return [];
  const time = num(backup.time);
  const when = time != null && at != null ? agoText(Math.max(0, at - time)) : backup.ago;
  const count = num(backup.vmCount) ?? 0;
  const status = String(backup.status ?? '').trim();
  const running = !backup.ok && (status === '' || /^running$/i.test(status));
  const vms = count === 1 ? '1 VM' : count > 0 ? `${count} VMs` : null;
  return [
    fact('when', 'When', when),
    fact('result', 'Result', backup.ok ? 'OK' : running ? 'Running' : status),
    fact('vms', 'Backed up', running ? vms && `${vms} so far` : (vms ?? 'No VMs')),
  ].filter(Boolean);
}

function nodeExtras({ status, entity, services, integrations, freshness, at }) {
  const card = infrastructureNodes({ status, services, freshness }).find((n) => n.id === entity.id);
  const metrics = services?.nodes?.[entity.node]?.metrics ?? null;
  // Units only while the model read the node this cycle: an old number is never current.
  const read = Boolean(card?.readings.some((r) => r.value != null));
  const memory =
    read && num(metrics?.memUsedGB) != null && num(metrics?.memTotalGB) != null
      ? `${metrics.memUsedGB} / ${metrics.memTotalGB} GB`
      : null;
  const disk =
    read && num(metrics?.diskUsed) != null && num(metrics?.diskTotal) != null
      ? `${metrics.diskUsed} / ${metrics.diskTotal} ${metrics.diskUnit || 'GB'}`
      : null;
  const facts = [
    fact('uptime', 'Uptime', read ? metrics?.uptime : null),
    fact('memory', 'Memory', memory),
    fact('disk', 'Disk', disk),
  ].filter(Boolean);

  const sections = [];
  const found = proxmoxEntryFor(integrations, entity.node);
  const pve = found?.[1] ?? null;
  if (pve) {
    const vms = Array.isArray(pve._vms) ? pve._vms.map(vmOf) : null;
    const pools = Array.isArray(pve._storagePools) ? pve._storagePools : null;
    if (vms?.length) {
      const running = vms.filter((v) => v.running).length;
      sections.push({
        key: 'vms',
        kind: 'vms',
        title: 'Virtual machines',
        aside: `${running} / ${vms.length} running`,
        vms,
      });
    }
    if (pools?.length) {
      sections.push({
        key: 'pools',
        kind: 'meters',
        title: 'Storage pools',
        meters: pools.map((p) => poolMeter(p, entity, status?.thresholds, freshness)),
      });
    }
    const backup = backupFacts(pve._lastBackup, at);
    if (backup.length)
      sections.push({ key: 'backup', kind: 'facts', title: 'Last backup', facts: backup });
    if (pve._error && !vms && !pools) {
      sections.push({
        key: 'proxmox',
        kind: 'note',
        title: 'Proxmox',
        note: `Its last read failed: ${pve._error}`,
      });
    }
  }
  return {
    // Not before /api/services has answered: a row of dashes would flash first.
    meters: services ? (card?.readings ?? []) : [],
    note: card?.services ?? null,
    facts,
    sections,
    proxmox: Boolean(pve),
  };
}

// ── Services and containers ──────────────────────────────────────────────

function serviceExtras({ entity, services, integrations, now }) {
  const uid = entity.id.slice('services/'.length);
  const { card = null, nodeName = entity.node } = cardOf(services, uid) ?? {};
  // Latency and uptime are Kuma's: a service's, never a container's.
  const kuma = entity.kind === 'service';
  const up = kuma && entity.state === 'ok';
  const ping = num(card?.ping);
  const facts = [
    fact('latency', 'Latency', up && ping && ping > 0 ? `${Math.round(ping)} ms` : null),
    fact(
      'uptime',
      'Uptime · 24 h',
      kuma && card?.uptime24 != null ? `${uptimePct(card.uptime24)} %` : null
    ),
    fact(
      'seen',
      'Last seen',
      card?.source === 'presence' && card.lastSeenAt != null
        ? lastSeenLabel(card.lastSeenAt, now ?? Date.now()).replace(/^last seen /, '')
        : null
    ),
    fact('node', 'Node', nodeName),
  ].filter(Boolean);

  const sections = [];
  const docker = card?.docker;
  if (isObject(docker)) {
    const host = docker.networkMode === 'host';
    const container = [
      fact('cpu', 'CPU', num(docker.cpu) != null ? `${docker.cpu} %` : null),
      fact('memory', 'Memory', memoryText(docker.memMB)),
      fact('rx', 'RX', host ? 'Host network' : rateText(docker.rxBytesPerSec)),
      fact('tx', 'TX', host ? 'Host network' : rateText(docker.txBytesPerSec)),
    ].filter(Boolean);
    if (container.length) {
      sections.push({
        key: 'container',
        kind: 'facts',
        title: 'Container',
        aside: card.container ?? null,
        facts: container,
      });
    }
  }

  if (isObject(integrations) && card) {
    const key = integrationClaims(integrations, services)[uid];
    if (key) sections.push(statsSection(key, integrations[key]));
  }
  return { meters: [], facts, sections, card, nodeName };
}

/** An integration's stats: its display fields, and why its last read failed. */
function statsSection(key, entry) {
  const shown = appEntryOf(entry);
  const facts = Object.entries(shown)
    .filter(
      ([label, value]) => !label.startsWith('_') && value != null && String(value).trim() !== ''
    )
    .map(([label, value]) => ({ key: label, label, value: String(value) }));
  return {
    key: 'integration',
    kind: facts.length ? 'facts' : 'note',
    title: `From ${key}`,
    facts,
    note: shown._doctor?.error ? `Its last read failed: ${shown._doctor.error}` : null,
  };
}

// ── The UPS ──────────────────────────────────────────────────────────────

/**
 * The UPS's facts, all the model's (#586): its charge (its metric), the
 * runtime, its load and model. The runtime on battery is the minutes left
 * (#549, upsReadingsOf); on mains, the minutes at this load. Neither is drawn
 * from a stale status: the one counts down, the other moves with the load.
 * A reading the model has none of (null) is left out, never drawn as 0.
 */
function upsExtras({ status, entity, freshness }) {
  const charge = entity.metric?.name === 'charge' ? num(entity.metric.value) : null;
  const left = upsReadingsOf({ status, freshness: freshness ?? FRESH });
  const atLoad = num(entity.runtimeOnMainsMinutes);
  const runtime =
    left ?? (atLoad != null && !freshness?.stale ? `${atLoad} min at this load` : null);
  const load = num(entity.load);
  const facts = [
    fact('charge', 'Charge', charge != null ? `${shownReading(charge)} %` : null),
    fact('runtime', 'Runtime', runtime),
    fact('load', 'Load', load != null ? `${load} %` : null),
    fact('model', 'Model', typeof entity.model === 'string' ? entity.model : null),
  ].filter(Boolean);
  return { meters: [], facts, sections: [] };
}

// ── Jobs and backups (#578) ──────────────────────────────────────────────

/**
 * A job's schedule and last report (the model's), and its last runs (the
 * read of /api/cron/status): the overdue line over them while the model says
 * it is overdue, a placeholder until the first read answers.
 */
function jobExtras({ entity, cron, at }) {
  const facts = [
    fact('schedule', 'Schedule', entity.schedule),
    fact('last', 'Last report', lastReportAgo(entity, at)),
  ].filter(Boolean);
  const read = cron !== undefined;
  const runs = read ? runsOf(cronEntryOf(cron?.body, entity), entity) : [];
  return {
    meters: [],
    facts,
    sections: [
      {
        key: 'runs',
        kind: 'runs',
        title: 'Last runs',
        note: overdueLine(entity, at),
        noteState: 'warn',
        // Before the first read answers (or fails) its runs aren't known.
        loading: !read || (cron.body == null && !cron.error),
        runs,
        // A read that failed with nothing before it: the Banner says so, not "none".
        ...(read && cron.body == null && cron.error ? { empty: null } : {}),
      },
    ],
  };
}

// ── The rest ─────────────────────────────────────────────────────────────

function integrationExtras({ entity, integrations }) {
  const key = entity.id.slice('integrations/'.length);
  const entry = isObject(integrations) ? integrations[key] : null;
  const sections = isObject(entry) ? [{ ...statsSection(key, entry), title: 'Stats' }] : [];
  return { meters: [], facts: [], sections };
}

/**
 * What the detail of `entity` adds: `{ meters, facts, sections, note?,
 * proxmox?, card?, unread }`.
 *
 *   meters    a node's readings, MetricMeter's props
 *   facts     label and value, the FactList's
 *   sections  each `{ key, kind, title, aside?, … }`: `facts` (facts, and a
 *             `note`), `meters` (meters, each with a `caption`), `vms` (a
 *             Proxmox node's machines) or `note` (one line)
 *   note      a node's hosted services, for its status box
 *   unread    the reads that failed: `{ key, what, error }`
 *   lastKnown with a stale status, "Last known 3 min ago": the facts and
 *             sections are drawn greyed, as last known (#480)
 *
 * `read` is useDetailSources' state: by source, `{ body, error }`.
 *
 * @param {{ status: any, entity: any, read?: Record<string, { body?: any, error?: string|null }>,
 *   services?: any, freshness?: any, at?: number|null, now?: number|null }} args
 */
export function entityExtras({
  status,
  entity,
  read = {},
  services = read.services?.body ?? null,
  freshness: given = FRESH,
  at = null,
  now = at,
}) {
  const freshness = given ?? FRESH;
  const integrations = read.integrations?.body ?? null;
  const args = { status, entity, services, integrations, freshness, at, now };
  let out;
  switch (entity?.kind) {
    case 'node':
      out = nodeExtras(args);
      break;
    case 'service':
    case 'container':
      out = serviceExtras(args);
      break;
    case 'ups':
      out = upsExtras(args);
      break;
    case 'integration':
      out = integrationExtras(args);
      break;
    case 'job':
    case 'backup':
      out = jobExtras({ entity, cron: read.cron, at });
      break;
    default:
      out = { meters: [], facts: [], sections: [] };
  }
  const unread = sourcesFor(entity, status).flatMap((key) => {
    const error = read[key]?.error;
    return error ? [{ key, what: SOURCE_WORDS[key], error }] : [];
  });
  // A stale status (#480): what its reads add is drawn as last known, greyed.
  const lastKnown = freshness.stale ? capital(freshness.lastKnown || 'last known') : null;
  return { ...out, unread, lastKnown };
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
