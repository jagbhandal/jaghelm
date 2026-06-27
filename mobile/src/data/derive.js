/**
 * Pure, framework-free derivation for the mobile screens. The server has NO
 * "incident" object; incidents and "degraded subsystems" are derived here from
 * the raw /services, /ups, /cron/status bodies so screens stay thin renderers.
 * Nothing in this file imports React or does I/O — it is table-testable.
 */

/** Format a uptime24 scalar (0–1) as "NN.N"; returns null when u is null/undefined. */
export function uptimePct(u) { return u != null ? (u * 100).toFixed(1) : null; }

/** CSS color token for a uptime24 scalar — matches the IncidentCard color ramp. */
export function uptimeColor(u) {
  return u == null ? 'var(--text-muted)' : u > 0.99 ? 'var(--green)' : u > 0.95 ? 'var(--amber)' : 'var(--red)';
}

/** parseFloat a string metric (node metrics arrive as strings); null if non-finite. */
export function parseMetricPct(str) {
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

/** A service is a "problem" iff it is explicitly down. 'unknown' is not a problem. */
export function serviceIsProblem(svc) {
  return (svc && svc.status) === 'down';
}

/** Flatten { nodes:{key:{services}} } → flat Service[] tagged with nodeKey/nodeName. */
export function flattenServices(servicesBody) {
  const nodes = servicesBody && servicesBody.nodes;
  if (!nodes) return [];
  const out = [];
  for (const [nodeKey, node] of Object.entries(nodes)) {
    for (const svc of node.services || []) {
      out.push({ ...svc, nodeKey, nodeName: node.display_name || nodeKey });
    }
  }
  return out;
}

/** Rank for the down → unknown → up sort. Presence breadcrumbs rank as unknown. */
function serviceRank(s) {
  if (s && s.status === 'down') return 0;
  if (s && (s.status === 'unknown' || s.source === 'presence')) return 1;
  return 2;
}

/** Stable down → unknown → up sort (original order preserved within a rank). No mutation. */
export function sortProblemsFirst(list) {
  return [...list]
    .map((s, i) => [s, i])
    .sort((a, b) => serviceRank(a[0]) - serviceRank(b[0]) || a[1] - b[1])
    .map(([s]) => s);
}

/** Group services under their node, preserving Object.entries order. */
export function groupByNode(servicesBody) {
  const nodes = (servicesBody && servicesBody.nodes) || {};
  return Object.entries(nodes).map(([nodeKey, node]) => ({
    nodeKey, node, services: node.services || [],
  }));
}

/**
 * Return the third metric bar descriptor for a node: TEMP when temp is present
 * (non-null, numeric), else DISK. Returns { label, value, unit, percent }.
 */
export function thirdMetric(metrics) {
  const m = metrics || {};
  const tempPct = parseMetricPct(m.temp);
  if (tempPct != null) {
    return { label: 'TEMP', value: m.temp, unit: '°C', percent: tempPct };
  }
  return { label: 'DISK', value: m.diskPercent, unit: '%', percent: parseMetricPct(m.diskPercent) };
}

/** Count up vs down for a node. down = explicit 'down'; up = everything else. */
export function nodeUpDown(node) {
  const services = (node && node.services) || [];
  let down = 0;
  for (const s of services) if (s.status === 'down') down += 1;
  return { up: services.length - down, down };
}

export function upsDegraded(ups) {
  return !!ups && ups.status === 0;
}

export function cronDegraded(cronBody) {
  if (!Array.isArray(cronBody)) return false;
  return cronBody.some((n) =>
    (n.jobs || []).some((j) => (j.runs || [])[0]?.status === 'failure')
  );
}

/** All newest-run failures from a cron body. Returns [] when none. */
export function allCronFailures(cronBody) {
  if (!Array.isArray(cronBody)) return [];
  const failures = [];
  for (const n of cronBody) {
    for (const j of n.jobs || []) {
      const run = (j.runs || [])[0];
      if (run && run.status === 'failure') {
        failures.push({ node: n.node, job: j.job, cause: run.error || 'Job failed', run });
      }
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Severity model (strict worst-of). Spec §5.
// Four levels, ranked so unknown (no-signal) sorts BELOW healthy: a node that
// reports no metrics can never drag overall severity up, but a real outage
// (critical) can never be diluted to healthy by calm peers.
// ---------------------------------------------------------------------------

/** Severity → numeric rank. Higher = worse (used for the worst-of MAX). */
export const SEVERITY = { unknown: -1, healthy: 0, caution: 1, critical: 2 };

/** Resource thresholds (mirror the UsageBar 75/90 ramp). cpu% and temp°C. */
export const CPU_HOT = 90;
export const TEMP_HOT = 75;

/** Numeric rank for a severity string (unrecognised → unknown's rank). */
export function severityRank(sev) {
  return Object.prototype.hasOwnProperty.call(SEVERITY, sev) ? SEVERITY[sev] : SEVERITY.unknown;
}

/** The worst (highest-rank) of the given severity strings. Empty → 'unknown'. */
export function maxSeverity(...sevs) {
  let best = 'unknown';
  for (const s of sevs) if (severityRank(s) > severityRank(best)) best = s;
  return best;
}

/** Map a service status (+ source) to a severity. Presence breadcrumbs → unknown. */
export function statusToSeverity(status, source) {
  if (source === 'presence') return 'unknown';
  if (status === 'up') return 'healthy';
  if (status === 'down') return 'critical';
  return 'unknown';
}

/** Map a service status (+ source) to a colorblind-safe lamp shape. (§6) */
export function statusToShape(status, source) {
  if (source === 'presence') return 'ring';
  if (status === 'up') return 'disc';
  if (status === 'down') return 'slash';
  return 'ring';
}

/**
 * Map a node's RESOURCE severity to a colorblind-safe lamp shape (NodeCard +
 * NodeDetail). Distinct from statusToShape (which keys off a service status):
 * critical → slash, unknown → ring, caution/healthy → disc.
 */
export function severityToShape(sev) {
  if (sev === 'critical') return 'slash';
  if (sev === 'unknown') return 'ring';
  return 'disc'; // caution (amber disc) + healthy (green disc)
}

/** Node resource-severity → status word (NodeCard + NodeDetail). caution →
 *  DEGRADED, healthy → OK, anything else (unknown/critical) → NO SIGNAL. */
export function nodeSeverityWord(sev) {
  return sev === 'caution' ? 'DEGRADED' : sev === 'healthy' ? 'OK' : 'NO SIGNAL';
}

/** Pluralize a word by count: n === 1 → word, else word + 's'. */
export function pluralize(n, word) {
  return `${word}${n === 1 ? '' : 's'}`;
}

/** Format UPS runtime seconds → "Xm" (whole minutes). null/NaN → null. */
export function formatRuntime(seconds) {
  if (seconds == null) return null;
  const n = Number(seconds);
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n / 60)}m`;
}

/**
 * RESOURCE-ONLY node severity. caution when cpu ≥ CPU_HOT or temp ≥ TEMP_HOT;
 * healthy when metrics are present and cool; unknown when no metrics reported.
 * A down service NEVER reddens a node — that lives in the Services cell + hero.
 */
export function nodeSeverity(node) {
  const m = (node && node.metrics) || {};
  const cpu = parseMetricPct(m.cpu);
  const mem = parseMetricPct(m.memPercent);
  const temp = parseMetricPct(m.temp);
  if (cpu == null && mem == null && temp == null) return 'unknown';
  if ((cpu != null && cpu >= CPU_HOT) || (temp != null && temp >= TEMP_HOT)) return 'caution';
  return 'healthy';
}

/** A "lone unknown" exists: a tracked unknown service (presence breadcrumbs excluded). */
export function hasUnknownService(services) {
  return flattenServices(services).some((s) => s.status === 'unknown' && s.source !== 'presence');
}

/**
 * Overall severity via strict worst-of (spec §5). Cascade:
 *   unreachable OR services==null → unknown (steel / NO SIGNAL, never green)
 *   else critical if any service is down
 *   else caution if UPS on battery | cron failure | a hot node | a lone unknown
 *   else healthy
 */
export function overallSeverity({ services, ups, cron, unreachable } = {}) {
  if (unreachable === true || services == null) return 'unknown';
  const flat = flattenServices(services);
  if (flat.some((s) => s.status === 'down')) return 'critical';
  const nodeHot = Object.values(services.nodes || {}).some((n) => nodeSeverity(n) === 'caution');
  // Reuse the already-flattened list rather than re-flattening via hasUnknownService.
  const loneUnknown = flat.some((s) => s.status === 'unknown' && s.source !== 'presence');
  if (upsDegraded(ups) || cronDegraded(cron) || nodeHot || loneUnknown) return 'caution';
  return 'healthy';
}

/** The "no signal" cell shared by every subsystem when unreachable / absent. */
const NO_SIGNAL_CELL = { severity: 'unknown', word: 'NO SIGNAL', detail: '—' };

/**
 * Per-subsystem { severity, word, detail } for an Overview cell (spec §5 table).
 * Only the Services cell has a critical (red) level; Nodes/UPS/Cron top out at
 * caution (amber). ctx = { services, ups, cron, unreachable }.
 */
export function subsystemSeverity(key, ctx = {}) {
  const { services, ups, cron, unreachable } = ctx;
  if (unreachable === true) return { ...NO_SIGNAL_CELL };

  if (key === 'services') {
    if (services == null) return { ...NO_SIGNAL_CELL };
    const flat = flattenServices(services);
    const total = flat.length;
    // Single pass for both counters (down + lone-unknown) instead of two filters.
    let down = 0;
    let unknown = 0;
    for (const s of flat) {
      if (s.status === 'down') down += 1;
      if (s.status === 'unknown' && s.source !== 'presence') unknown += 1;
    }
    if (down > 0) return { severity: 'critical', word: 'DOWN', detail: `${total - down} / ${total}` };
    if (unknown > 0) return { severity: 'caution', word: 'DEGRADED', detail: `${unknown} unknown` };
    return { severity: 'healthy', word: 'OK', detail: `${total} / ${total}` };
  }

  if (key === 'nodes') {
    if (services == null) return { ...NO_SIGNAL_CELL };
    const nodes = Object.values(services.nodes || {});
    const hot = nodes.filter((n) => nodeSeverity(n) === 'caution');
    if (hot.length > 0) {
      const peak = hot
        .map((n) => parseMetricPct((n.metrics || {}).cpu))
        .filter((v) => v != null)
        .reduce((a, b) => Math.max(a, b), -Infinity);
      const detail = Number.isFinite(peak) ? `${hot.length} hot · ${Math.round(peak)}%` : `${hot.length} hot`;
      return { severity: 'caution', word: 'DEGRADED', detail };
    }
    return { severity: 'healthy', word: 'OK', detail: `${nodes.length} online` };
  }

  if (key === 'ups') {
    if (!ups || ups.status == null) return { ...NO_SIGNAL_CELL };
    const charge = ups.charge != null ? Math.round(ups.charge) : null;
    if (ups.status === 0) {
      const rt = formatRuntime(ups.runtime);
      const detail = charge != null
        ? (rt ? `${charge}% · ${rt}` : `${charge}%`)
        : (rt || '—');
      return { severity: 'caution', word: 'ON BATTERY', detail };
    }
    return { severity: 'healthy', word: 'MAINS', detail: charge != null ? `${charge}%` : '—' };
  }

  if (key === 'cron') {
    const failures = allCronFailures(cron);
    if (failures.length > 0) {
      return { severity: 'caution', word: 'FAILED', detail: `${failures.length} job${failures.length === 1 ? '' : 's'}` };
    }
    return { severity: 'healthy', word: 'OK', detail: `${failures.length} fail` };
  }

  return { ...NO_SIGNAL_CELL };
}

/**
 * The 4 Overview subsystem cells, in order [services, nodes, ups, cron]. Each is
 * { key, label, severity, word, detail } (§5). `unreachable` forces every cell
 * to NO SIGNAL / unknown so a mid-session outage never renders as stale green.
 */
export function deriveSubsystems(ctx) {
  return [
    { key: 'services', label: 'Services', ...subsystemSeverity('services', ctx) },
    { key: 'nodes', label: 'Nodes', ...subsystemSeverity('nodes', ctx) },
    { key: 'ups', label: 'UPS', ...subsystemSeverity('ups', ctx) },
    { key: 'cron', label: 'Cron', ...subsystemSeverity('cron', ctx) },
  ];
}

/**
 * Derive active incidents from down services + on-battery UPS + failing cron +
 * tracked-unknown services. Sorted down → ups → cron → unknown, then by id
 * (deterministic & stable across input reordering). Each incident carries
 * presentational fields { severity, word, shape, readout } and an open `target`.
 *
 * Honest numbers: the snapshot has NO real detection time for derived incidents
 * (no `downSince`; `ping` is latency, not age), so NO timestamp/age field is
 * synthesized. `readout` is node + a genuinely-real datum only (spec §7.2).
 */
export function deriveIncidents({ services, ups, cron } = {}) {
  const incidents = [];
  const flat = flattenServices(services); // flatten once, reused by both service loops

  // Down services → red DOWN (slash). readout = node only (no invented age).
  for (const svc of flat) {
    if (svc.status === 'down') {
      incidents.push({
        id: `service:${svc.uid}`, kind: 'service', title: svc.display_name,
        node: svc.nodeName, cause: 'Service is down', uptime24: svc.uptime24 ?? null,
        status: 'down', severity: 'critical', word: 'DOWN', shape: 'slash',
        readout: svc.nodeName,
        target: { kind: 'service', uid: svc.uid, url: svc.url || '' },
      });
    }
  }

  // UPS on battery → amber ON BATTERY (bolt). readout = {charge}% · {runtime}.
  if (upsDegraded(ups)) {
    const charge = ups.charge != null ? Math.round(ups.charge) : null;
    const runtime = formatRuntime(ups.runtime);
    const readout = charge != null
      ? (runtime ? `${charge}% · ${runtime}` : `${charge}%`)
      : (runtime || '');
    incidents.push({
      id: 'ups:apcups', kind: 'ups', title: 'UPS on battery', node: 'UPS',
      cause: `On battery${charge != null ? ` — ${charge}% charge` : ''}`,
      uptime24: null, status: 'down', severity: 'caution', word: 'ON BATTERY', shape: 'bolt',
      readout,
      target: { kind: 'ups' },
    });
  }

  // Cron failures → amber FAILED (slash). readout = node; cause = real run error.
  for (const cf of allCronFailures(cron)) {
    incidents.push({
      id: `cron:${cf.node}:${cf.job}`, kind: 'cron', title: `${cf.job} failed`, node: cf.node,
      cause: cf.cause, uptime24: null, status: 'down', severity: 'caution', word: 'FAILED', shape: 'slash',
      readout: cf.node,
      target: { kind: 'cron', job: cf.job },
    });
  }

  // Tracked-unknown services → steel UNKN (ring). Presence breadcrumbs excluded.
  for (const svc of flat) {
    if (svc.status === 'unknown' && svc.source !== 'presence') {
      incidents.push({
        id: `unknown:${svc.uid}`, kind: 'unknown', title: svc.display_name,
        node: svc.nodeName, cause: 'No signal', uptime24: svc.uptime24 ?? null,
        status: 'unknown', severity: 'unknown', word: 'UNKN', shape: 'ring',
        readout: `${svc.nodeName} · no signal`,
        target: { kind: 'service', uid: svc.uid, url: svc.url || '' },
      });
    }
  }

  const rank = (k) => (k === 'service' ? 0 : k === 'ups' ? 1 : k === 'cron' ? 2 : 3);
  return incidents.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The set of active incident ids — history renders only ids NOT in this set. */
export function activeIncidentIds(incidents) {
  return new Set((incidents || []).map((i) => i.id));
}

// ---------------------------------------------------------------------------
// Caution precedence + hero headline (spec §7.1 / §7.2). One source of truth for
// the worst-of "caution" wording, shared by the MobileApp annunciator sentence
// and the Overview hero headline so they can never drift.
// ---------------------------------------------------------------------------

// 1 → "One", 2 → "Two", ≥3 → digit (spec §7.2 down-headline rule).
const WORD_NUMBER = { 1: 'One', 2: 'Two' };
const wordNumber = (n) => WORD_NUMBER[n] || String(n);

/**
 * Presentation for a single caution kind: { kind, count, charge, headline, word,
 * prose }. `headline` doubles as the annunciator sentence and the hero headline;
 * `word`/`prose` feed the hero. The default branch is the "Degraded" fallback.
 */
function cautionDescriptor(kind, count, charge) {
  switch (kind) {
    case 'ups':
      return { kind, count, charge, headline: 'UPS on battery', word: 'battery',
        prose: `On battery power${charge != null ? ` — ${charge}% charge` : ''}.` };
    case 'cron':
      return { kind, count, charge, headline: `${count} cron ${pluralize(count, 'job')} failed`, word: 'failed',
        prose: `${count} cron ${pluralize(count, 'job')} reported a failure.` };
    case 'hot':
      return { kind, count, charge, headline: `${count} ${pluralize(count, 'node')} running hot`, word: 'hot',
        prose: `${count} ${pluralize(count, 'node')} over the resource threshold.` };
    case 'unknown':
      return { kind, count, charge, headline: `${count} ${pluralize(count, 'service')} unknown`, word: 'unknown',
        prose: `${count} ${pluralize(count, 'service')} not reporting.` };
    default:
      return { kind: 'degraded', count: 0, charge: null, headline: 'Degraded', word: 'Degraded',
        prose: 'A subsystem needs attention.' };
  }
}

/**
 * All active cautions in spec precedence ups → cron → node-hot → unknown. Empty
 * when nothing is in caution. Internal — exposed via worstCaution + deriveHero.
 */
function listCautions({ services, ups, cron } = {}) {
  const out = [];
  if (upsDegraded(ups)) {
    const charge = ups && ups.charge != null ? Math.round(ups.charge) : null;
    out.push(cautionDescriptor('ups', 0, charge));
  }
  const cronFails = allCronFailures(cron).length;
  if (cronFails > 0) out.push(cautionDescriptor('cron', cronFails, null));
  const hot = Object.values((services && services.nodes) || {}).filter((n) => nodeSeverity(n) === 'caution').length;
  if (hot > 0) out.push(cautionDescriptor('hot', hot, null));
  const unknown = flattenServices(services).filter((s) => s.status === 'unknown' && s.source !== 'presence').length;
  if (unknown > 0) out.push(cautionDescriptor('unknown', unknown, null));
  return out;
}

/**
 * The single worst caution by precedence (ups → cron → node-hot → unknown), or
 * null when nothing is in caution. The annunciator renders `.headline`; the hero
 * uses `.headline`/`.word`. ctx = { services, ups, cron }.
 */
export function worstCaution(ctx) {
  return listCautions(ctx)[0] || null;
}

/**
 * The Overview hero { severity, headline, word, subline, counts } per spec §7.2.
 * `word` is the substring of `headline` the SystemStatusCard color-spans by
 * severity. ctx = { services, ups, cron }. Pure: callers just render the result.
 */
export function deriveHero(severity, { services, ups, cron } = {}) {
  // unknown / unreachable — never green (Bug #4).
  if (severity === 'unknown') {
    return { severity, headline: 'No signal', word: 'No signal', subline: "Can't reach JagHelm", counts: '' };
  }

  const flat = flattenServices(services);
  const upCount = flat.filter((s) => s.status === 'up').length;
  const downServices = flat.filter((s) => s.status === 'down');
  const downCount = downServices.length;
  const unknownCount = flat.filter((s) => s.status === 'unknown' && s.source !== 'presence').length;
  const nodeCount = Object.keys((services && services.nodes) || {}).length;
  const onBattery = upsDegraded(ups);

  // Mono counts footer — shared across non-unknown states.
  const counts = [
    `${upCount} up`,
    `${downCount} down`,
    ...(unknownCount > 0 ? [`${unknownCount} unknown`] : []),
    `${nodeCount} ${pluralize(nodeCount, 'node')}`,
  ].join(' · ');

  // healthy
  if (severity === 'healthy') {
    const upsTail = ups ? ` — UPS on ${onBattery ? 'battery' : 'mains'}` : '';
    return {
      severity,
      headline: "Everything's healthy",
      word: 'healthy',
      subline: `${upCount} ${pluralize(upCount, 'service')} up across ${nodeCount} ${pluralize(nodeCount, 'node')}${upsTail}`,
      counts,
    };
  }

  // critical (down) — count words, up-to-2 names + "+N more", co-existing caution tail.
  if (severity === 'critical') {
    const headline = `${wordNumber(downCount)} ${pluralize(downCount, 'service')} down`;
    const names = downServices.slice(0, 2).map((s) => s.display_name).join(' · ');
    const more = downCount > 2 ? ` +${downCount - 2} more` : '';
    const cronFails = allCronFailures(cron).length;
    let tail = '';
    if (onBattery) tail = ' — plus UPS on battery';
    else if (cronFails > 0) tail = ` — plus ${cronFails} cron ${pluralize(cronFails, 'failure')}`;
    return { severity, headline, word: 'down', subline: `${names}${more}${tail}`, counts };
  }

  // caution (no down) — headline the single worst caution by precedence; the rest
  // are summarized in the subline.
  const cautions = listCautions({ services, ups, cron });
  const first = cautions[0] || cautionDescriptor('degraded');
  const rest = cautions.slice(1).map((c) => c.prose).join(' ');
  return { severity, headline: first.headline, word: first.word, subline: rest || first.prose, counts };
}

/**
 * Real wall-clock "HH:MM" from an epoch-ms number, numeric string, or ISO string.
 * Null-safe: returns null for null/empty/unparseable input (honest numbers — no
 * real datum, no clock). Pure (no I/O). Shared by RefreshStatus + IncidentDetail.
 */
export function formatClock(ts) {
  if (ts == null || ts === '') return null;
  const ms = typeof ts === 'number'
    ? ts
    : (/^\d+$/.test(String(ts).trim()) ? Number(ts) : Date.parse(ts));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
