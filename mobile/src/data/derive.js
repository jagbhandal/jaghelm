/**
 * Pure, framework-free derivation for the mobile screens. The server has NO
 * "incident" object; incidents and "degraded subsystems" are derived here from
 * the raw /services, /ups, /cron/status bodies so screens stay thin renderers.
 * Nothing in this file imports React or does I/O — it is table-testable.
 */

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

/** Stable problems-first sort (down → rest, original order preserved). No mutation. */
export function sortProblemsFirst(list) {
  return [...list]
    .map((s, i) => [s, i])
    .sort((a, b) => {
      const pa = serviceIsProblem(a[0]) ? 0 : 1;
      const pb = serviceIsProblem(b[0]) ? 0 : 1;
      return pa - pb || a[1] - b[1];
    })
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

/** Newest-run failure cause for a cron body, or null. (Helper for incidents.) */
function firstCronFailure(cronBody) {
  if (!Array.isArray(cronBody)) return null;
  for (const n of cronBody) {
    for (const j of n.jobs || []) {
      const run = (j.runs || [])[0];
      if (run && run.status === 'failure') {
        return { node: n.node, job: j.job, cause: run.error || 'Job failed', run };
      }
    }
  }
  return null;
}

/** The 4 Overview subsystem cells. degraded drives the alarm tint. */
export function deriveSubsystems({ services, ups, cron }) {
  const flat = flattenServices(services);
  const downCount = flat.filter(serviceIsProblem).length;
  const nodeCount = Object.keys((services && services.nodes) || {}).length;
  return [
    { key: 'services', label: 'Services', degraded: downCount > 0, detail: downCount ? `${downCount} down` : `${flat.length} up` },
    { key: 'nodes', label: 'Nodes', degraded: false, detail: `${nodeCount} online` },
    { key: 'ups', label: 'UPS', degraded: upsDegraded(ups), detail: upsDegraded(ups) ? 'On battery' : 'Mains' },
    { key: 'cron', label: 'Cron', degraded: cronDegraded(cron), detail: cronDegraded(cron) ? 'Job failed' : 'Healthy' },
  ];
}

/**
 * Derive active incidents from down services + on-battery UPS + failing cron.
 * Ordered service→ups→cron then by id; ids are deterministic so the list is
 * stable across input reordering. Each incident carries an open `target`.
 */
export function deriveIncidents({ services, ups, cron }) {
  const incidents = [];
  for (const svc of flattenServices(services)) {
    if (svc.status === 'down') {
      incidents.push({
        id: `service:${svc.uid}`, kind: 'service', title: svc.display_name,
        node: svc.nodeName, cause: 'Service is down', uptime24: svc.uptime24 ?? null,
        status: 'down', target: { kind: 'service', uid: svc.uid, url: svc.url || '' },
      });
    }
  }
  if (upsDegraded(ups)) {
    incidents.push({
      id: 'ups:apcups', kind: 'ups', title: 'UPS on battery', node: 'UPS',
      cause: `On battery${ups.charge != null ? ` — ${Math.round(ups.charge)}% charge` : ''}`,
      uptime24: null, status: 'down', target: { kind: 'ups' },
    });
  }
  const cf = firstCronFailure(cron);
  if (cf) {
    incidents.push({
      id: `cron:${cf.node}:${cf.job}`, kind: 'cron', title: `${cf.job} failed`, node: cf.node,
      cause: cf.cause, uptime24: null, status: 'down', target: { kind: 'cron', job: cf.job },
    });
  }
  const rank = (k) => (k === 'service' ? 0 : k === 'ups' ? 1 : 2);
  return incidents.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
