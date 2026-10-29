/**
 * How the Alerts pages (#314) read their filters and word the alert history.
 * Pure: the web's Alerts page (AlertsPage.jsx), the phone's Alerts tab
 * (src/phone/views/Alerts.jsx) read these.
 *
 * The filters are three: a severity (critical, warning or info, the alerts'
 * own, as push and /api/events have them), a kind of entity (the first part
 * of the model's id: services, nodes, power, jobs, backups, integrations or
 * sources) and a search. On the web they are the page's address
 * (`/alerts?severity=critical&kind=services&q=jelly`, alertsFilter.js), so
 * Back undoes one and a link opens the page filtered.
 *
 * Active filters the status model's issues here, in the client: the status is
 * already in hand, and small. History asks /api/events with the same filters
 * (eventsQuery), so the server filters: it keeps up to 1000 events and sends
 * them a page at a time, and a filter in the client would see one page only.
 *
 * The server judges every state (spec §6): an event's lamp is its severity,
 * its words the push's (push/differ.js), its change the step its type names
 * (changeOf). Nothing here judges anything.
 */
import { DRIVE_PREFIX } from '../../server/status/drives.js';
import { listFiltersSearch } from './filterQuery.js';
import { whereOf } from './statusView.js';
import { dateToDayKey, formatDayLabel } from '../phone/data/groupByDay.js';
import { formatClock } from '../phone/data/derive.js';

/** The severities, as the filter offers them. */
export const SEVERITY_OPTIONS = Object.freeze([
  { id: 'critical', label: 'Critical' },
  { id: 'warning', label: 'Warning' },
  { id: 'info', label: 'Info' },
]);

/** The kinds of entity, as the filter offers them (server/push/alertHistory.js ENTITY_KINDS). */
export const KIND_OPTIONS = Object.freeze([
  { id: 'services', label: 'Services' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'power', label: 'Power' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'backups', label: 'Backups' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'sources', label: 'Monitoring sources' },
]);

const SEVERITY_IDS = new Set(SEVERITY_OPTIONS.map((o) => o.id));
const KIND_IDS = new Set(KIND_OPTIONS.map((o) => o.id));

/** The query parameters the filters are kept in. */
export const FILTER_PARAMS = Object.freeze({ severity: 'severity', kind: 'kind', q: 'q' });
export const ALERT_FILTER_KEYS = Object.freeze(Object.values(FILTER_PARAMS));

/** The longest search the server takes (routes/events.js MAX_QUERY_TEXT). */
export const MAX_SEARCH = 100;

/** No filter: everything. */
export const NO_FILTERS = Object.freeze({ severity: null, kind: null, q: '' });

/** The filters `search` (a URL's query) holds: what it doesn't know is no filter. */
export function readAlertFilters(search) {
  const params = new URLSearchParams(search);
  const severity = params.get(FILTER_PARAMS.severity);
  const kind = params.get(FILTER_PARAMS.kind);
  const q = (params.get(FILTER_PARAMS.q) ?? '').trim().slice(0, MAX_SEARCH);
  return {
    severity: SEVERITY_IDS.has(severity) ? severity : null,
    kind: KIND_IDS.has(kind) ? kind : null,
    q,
  };
}

/** Whether `filters` narrow anything. */
export function hasFilters(filters) {
  return Boolean(filters.severity || filters.kind || filters.q);
}

/**
 * The query `search` with its filters replaced by `filters` ("" when nothing
 * is left): the other parameters (an open entity) stay before them, as
 * written (filterQuery.js, the list pages' one writer).
 */
export function alertFiltersSearch(filters, search) {
  return listFiltersSearch(filters, search, ALERT_FILTER_KEYS);
}

/** The query History asks /api/events with: the filters set, and nothing else. */
export function eventsQuery(filters) {
  const query = {};
  if (filters.severity) query.severity = filters.severity;
  if (filters.kind) query.kind = filters.kind;
  if (filters.q) query.q = filters.q;
  return query;
}

const KIND_NOUN = Object.freeze({
  services: 'services',
  nodes: 'nodes',
  power: 'power',
  jobs: 'jobs',
  backups: 'backups',
  integrations: 'integrations',
  sources: 'monitoring sources',
});

/**
 * What `filters` show, in words, or null with none: "critical alerts",
 * "alerts on services", "info alerts on nodes matching “pve”".
 */
export function filterSummary(filters) {
  if (!hasFilters(filters)) return null;
  return [
    filters.severity ? `${filters.severity} alerts` : 'alerts',
    filters.kind && `on ${KIND_NOUN[filters.kind]}`,
    filters.q && `matching “${filters.q}”`,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The model's issue states each severity filter keeps (no signal is none of them). */
const ISSUE_STATE = Object.freeze({ critical: 'crit', warning: 'warn', info: null });

const has = (text, needle) => typeof text === 'string' && text.toLowerCase().includes(needle);

/** Whether the model's `issue` is one `filters` leave on Active. */
export function issueMatches(issue, filters) {
  if (filters.severity && issue.state !== ISSUE_STATE[filters.severity]) return false;
  if (filters.kind && issue.subsystem !== filters.kind) return false;
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const said = [issue.name, whereOf(issue), issue.word, issue.reason, issue.id];
    if (!said.some((text) => has(text, needle))) return false;
  }
  return true;
}

// ── An event as a row ─────────────────────────────────────────────────────

/** The state an event's lamp draws: its severity's; a recovery is ok. */
const EVENT_STATE = Object.freeze({ critical: 'crit', warning: 'warn', info: 'ok' });

/**
 * The step each type of event names (push/differ.js, server/arcane/format.js):
 * `[from, to]` in the model's words, `from` null where the type doesn't pin
 * it (a service goes down from up, pending or maintenance; a failed run
 * follows a good one or an overdue one), so a row never says a state it
 * can't know.
 */
const CHANGE = Object.freeze({
  service_down: [null, 'Down'],
  service_recovered: ['Down', 'Up'],
  host_unreachable: [null, 'Unreachable'],
  host_recovered: ['Unreachable', 'Reachable'],
  host_threshold_cleared: [null, 'Normal'],
  ups_on_battery: [null, 'On battery'],
  ups_restored: ['On battery', 'On mains'],
  cron_failed: [null, 'Failed'],
  cron_overdue: [null, 'Overdue'],
  cron_recovered: [null, 'OK'],
  source_down: ['Up', 'Down'],
  source_recovered: ['Down', 'Up'],
  arcane_agent_offline: ['Online', 'Offline'],
  arcane_agent_recovered: ['Offline', 'Online'],
});

/**
 * The change an event records, "Down → Up", or just what it became where
 * the type doesn't say from what ("Down", "Critical"); null for a notice
 * that changes no state (an Arcane update or digest).
 */
export function changeOf(event) {
  if (event.type === 'host_threshold')
    return event.severity === 'critical' ? 'Critical' : 'Warning';
  const step = Object.hasOwn(CHANGE, event.type) ? CHANGE[event.type] : null;
  if (!step) return null;
  return step[0] ? `${step[0]} → ${step[1]}` : step[1];
}

/** What push did with an event (push/alertHistory.js), in words; null without a record of it. */
export function deliveryText(push) {
  switch (push?.state) {
    case 'sent':
      return `Sent to ${push.phones} ${push.phones === 1 ? 'phone' : 'phones'}`;
    case 'queued':
      return 'Sending';
    case 'off':
      return 'Push not set up';
    case 'suppressed':
      return 'Not sent: off in phone settings';
    case 'unsent':
      return 'Not sent';
    case 'dropped':
      return 'Not sent: dropped';
    default:
      return null;
  }
}

/** The noun an entity's kind goes by, from its id, for one the model no longer has. */
const KIND_OF_ID = Object.freeze({
  services: 'Service',
  nodes: 'Node',
  power: 'Power',
  jobs: 'Job',
  backups: 'Backup',
  integrations: 'Integration',
  sources: 'Monitoring source',
});
const PLACE_OF_ID = Object.freeze({ 'sources/config': 'Configuration' });
// The kinds whose events name a node the model files the entity under.
const ON_A_NODE = new Set(['services', 'nodes', 'jobs', 'backups']);

/** Where an entity the model no longer has was, from its id and the event's node. */
function whereOfId(id, node) {
  if (PLACE_OF_ID[id]) return PLACE_OF_ID[id];
  const kind = id.split('/')[0];
  const noun = id.startsWith('integrations/arcane:') ? 'Arcane agent' : KIND_OF_ID[kind];
  if (!noun) return undefined;
  return [noun, ON_A_NODE.has(kind) || noun === 'Arcane agent' ? node : null]
    .filter(Boolean)
    .join(' · ');
}

const ANSWERING = ' is answering again';

/** The model's words for a thing that is fine, which say nothing a recovery's change doesn't. */
const FINE = new Set([
  'healthy',
  'ok',
  'up',
  'on mains',
  'running',
  'online',
  'normal',
  'reachable',
]);

/**
 * Whether `reason` only says the state `change` ends in again: the same words
 * ("On battery → On mains" · "On mains"), or, for an ok event, the model's
 * word for fine ("Normal" · "Healthy"). A reason with evidence of its own
 * stays ("Kuma: up", "On battery (88 % charge)", "Last run succeeded").
 */
export function restates(reason, change, state) {
  if (!reason || !change) return false;
  const said = reason.trim().toLowerCase();
  const to = change.split(' → ').pop().toLowerCase();
  return said === to || (state === 'ok' && FINE.has(said));
}

const DRIVE_RANK = { crit: 3, warn: 2, unknown: 1 };

/**
 * The drive a Needs attention node is there for (#728), or null: the worst
 * drive of a node entity (name order among equals), only when its state is the
 * node's own, so a node that is amber for its CPU does not mark a drive.
 */
export function driveOfIssue(entity) {
  if (entity?.kind !== 'node' || !Array.isArray(entity.drives)) return null;
  const worst = entity.drives
    .filter((d) => typeof d?.device === 'string' && DRIVE_RANK[d.state])
    .sort((a, b) => DRIVE_RANK[b.state] - DRIVE_RANK[a.state] || (a.device < b.device ? -1 : 1))[0];
  return worst && worst.state === entity.state ? worst.device : null;
}

/**
 * The device of the drive an event is about (#728), or null: a drive's reading
 * event has the key `<node>:drive:<node>:<device>` (server/push/entity.js
 * driveOf says the same for a push's URL).
 */
export function driveOfEvent(event) {
  const node = typeof event?.node === 'string' ? event.node : '';
  const prefix = `${node}:${DRIVE_PREFIX}${node}:`;
  const key = typeof event?.key === 'string' ? event.key : '';
  if (!node || !String(event?.type ?? '').startsWith('host_') || !key.startsWith(prefix))
    return null;
  return key.slice(prefix.length) || null;
}

/**
 * The name an event's words give its entity: the push's body is "<name> ·
 * <reason>", a service's or a job's name followed by " on <node>" (#407: one
 * outage names every node); a source's recovery, "<name> is answering
 * again". Null when the body doesn't say one.
 */
function nameInWords(event) {
  const { body, reason, type } = event;
  if (typeof body !== 'string') return null;
  // A source's recovery says "<name> is answering again" (push/differ.js).
  if (type === 'source_recovered' && body.endsWith(ANSWERING))
    return body.slice(0, -ANSWERING.length);
  if (!reason || !body.endsWith(` · ${reason}`)) return null;
  const subject = body.slice(0, -(reason.length + 3));
  return /^(?:service|cron)_/.test(type) ? subject.replace(/ on [^·]+$/, '') : subject;
}

/**
 * Event `event` (one /api/events record) as a history row: `{ id, entity,
 * state, name, where, change, reason, cause, at, time, delivery, reached, gone }`.
 * A reason that only says the change again is left out (restates).
 * Its name and where are the model's for an entity it still has (`entities`,
 * the status's by id), else what the event said; one with neither says its
 * title, and its words as the reason. `gone`: the model, known, no longer has
 * its entity (a row still opens it: the detail says "No longer monitored"),
 * but for a failed source, which the model lists only while it fails.
 *
 * @param {object} event
 * @param {Map<string, object> | null} entities
 */
export function historyRow(event, entities) {
  const entity = event.entity ?? null;
  const known = entity !== null && entities ? entities.get(entity) : undefined;
  const said = nameInWords(event);
  const name = known?.name ?? said ?? event.title;
  const where = known
    ? whereOf(known)
    : entity !== null
      ? whereOfId(entity, event.node)
      : undefined;
  const drive = entity?.startsWith('nodes/') ? driveOfEvent(event) : null;
  const state = EVENT_STATE[event.severity] ?? 'unknown';
  const change = changeOf(event);
  const given = event.reason ?? (said !== null ? null : event.body || null);
  const reason = restates(given, change, state) ? null : given;
  const at = Date.parse(event.at);
  return {
    id: event.id,
    entity,
    // The drive in the node a drive's alert is about (#728), to open it marked.
    ...(drive ? { drive } : {}),
    state,
    name,
    where,
    change,
    reason,
    // A known cause (#669): the label Settings → Notifications gave a matching alert.
    cause: typeof event.cause === 'string' && event.cause !== '' ? event.cause : null,
    at,
    time: formatClock(at),
    delivery: deliveryText(event.push),
    reached: event.push?.state === 'sent',
    // A failed source is in the model only while it fails (IncidentDetail
    // calls it resolved): it is not gone.
    gone: entity !== null && Boolean(entities) && !known && !entity.startsWith('sources/'),
  };
}

/**
 * History's rows by the day they happened (the viewer's own calendar), newest
 * first, each day labelled as the phone's lists label one: "Today",
 * "Yesterday", or the date ("Oct 18").
 *
 * @param {Array<{ at: number }>} rows newest first
 * @param {number} now
 */
export function historyDays(rows, now) {
  const today = dateToDayKey(new Date(now));
  const days = [];
  for (const row of rows) {
    const day = dateToDayKey(new Date(row.at));
    const last = days[days.length - 1];
    if (last?.day === day) last.rows.push(row);
    else days.push({ day, label: formatDayLabel(day, today), rows: [row] });
  }
  return days;
}

/**
 * History's days from /api/events' records: each a row (historyRow, the
 * model's names from `status`), with what opens its entity (`open(id)`, a
 * row's `{ href, onOpen }` or `{ onOpen }`) when it has one, grouped by day
 * against `now` (historyDays).
 *
 * @param {object[]} events
 * @param {{ entities?: object[] } | null} status
 * @param {number} now
 * @param {(id: string) => object} [open]
 */
export function historyView(events, status, now, open) {
  const entities = status ? new Map((status.entities ?? []).map((e) => [e.id, e])) : null;
  const rows = events.map((event) => {
    const row = historyRow(event, entities);
    return row.entity && open ? { ...row, ...open(row.entity, { drive: row.drive }) } : row;
  });
  return historyDays(rows, now);
}
