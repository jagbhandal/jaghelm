/*
 * The phone screens' boards for the gallery (#303): the signed-off mock's Phone
 * board, as the status model and /api/services would say it (the shapes of
 * docs/ARCHITECTURE.md §4.7), so a state here reads against the mock item for
 * item. Plain data: homelab-looking placeholders, no real hosts or addresses.
 * The gallery's clock is frozen at GALLERY_NOW (2026-10-20 09:00 UTC); each
 * `since` is that many minutes before it.
 */
import { encodeBeats } from '../server/kumaBeats.js';

const NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
const ago = (minutes) => NOW - minutes * 60_000;

// The heartbeat strips (#312), as /api/services carries them: a service's
// last 50 checks, one every 30 s, the newest 20 s before NOW. A pattern
// reads oldest first: o up, x down, w pending.
const STATUS = { o: 1, x: 0, w: 2 };
const strip = (pattern, ping) =>
  encodeBeats(
    [...pattern].map((c, i, all) => ({
      t: NOW - 20_000 - (all.length - 1 - i) * 30_000,
      s: STATUS[c],
      p: c === 'o' ? ping + ((i * 7) % 9) - 4 : null,
    }))
  );
const ups = (n) => 'o'.repeat(n);

const THRESHOLDS = {
  cpu: { warn: 0.9, cycles: 2 },
  mem: { warn: 0.9 },
  disk: { warn: 0.9, crit: 0.95 },
  temp: { warn: 75, crit: 85 },
  hysteresis: { fraction: 0.05, celsius: 5 },
  pending: { cycles: 2 },
};

const card = (node, id, name, status, ping, more = {}) => ({
  container: id,
  uid: `${node}:${id}`,
  display_name: name,
  icon: null,
  status,
  monitored: true,
  ping,
  uptime24: status === 'up' ? 1 : 0.94,
  docker: status === 'up' ? { cpu: 2.1, memMB: 180 } : null,
  integration: null,
  source: 'container',
  ...more,
});

/** /api/services: the two nodes and their six services. */
function servicesOf(incident) {
  return {
    nodes: {
      'vm-103': {
        display_name: 'Production',
        subtitle: 'Proxmox VM',
        border_color: '#8b5cf6',
        reachable: true,
        failedReads: [],
        metrics: { cpu: '21.4', memPercent: '58.2', diskPercent: '61.0', uptime: '6d 2h' },
        services: [
          card('vm-103', 'immich', 'Immich', incident ? 'down' : 'up', incident ? null : 138, {
            url: 'https://immich.example/',
          }),
          card('vm-103', 'wikijs', 'Wiki.js', incident ? 'pending' : 'up', incident ? null : 88),
          card('vm-103', 'nextcloud', 'Nextcloud', 'up', 182),
          card('vm-103', 'home-assistant', 'Home Assistant', 'up', 35),
          card('vm-103', 'vaultwarden', 'Vaultwarden', 'up', 54),
        ],
      },
      jagnas: {
        display_name: 'JagNAS',
        subtitle: 'Storage, B2 sync',
        border_color: '#14b8a6',
        reachable: true,
        failedReads: [],
        metrics: {
          cpu: '21.0',
          memPercent: '44.0',
          diskPercent: incident ? '92.4' : '71.0',
          temp: '44.0',
          uptime: '41d 6h',
        },
        services: [card('jagnas', 'adguard', 'AdGuard Home', 'up', 9)],
      },
    },
    // Immich down for the last 4 minutes in the incident; Wiki.js's monitor
    // added 2 minutes ago, with no check yet (the mock's hollow beats).
    beats: {
      'vm-103:immich': strip(incident ? `${ups(41)}w${'x'.repeat(8)}` : ups(50), 138),
      'vm-103:wikijs': incident ? encodeBeats([]) : strip(ups(50), 88),
      'vm-103:nextcloud': strip(`${ups(30)}wx${ups(18)}`, 182),
      'vm-103:home-assistant': strip(ups(50), 35),
      'vm-103:vaultwarden': strip(ups(50), 54),
      'jagnas:adguard': strip(ups(50), 9),
    },
  };
}

const service = (uid, name, node, state, word, reason, since) => ({
  id: `services/${uid}`,
  kind: 'service',
  subsystem: 'services',
  name,
  node,
  state,
  word,
  reason,
  since,
});

function statusOf(incident) {
  const services = [
    incident
      ? service(
          'vm-103:immich',
          'Immich',
          'vm-103',
          'crit',
          'Down',
          'Kuma: HTTP 502 for 4 min',
          ago(4)
        )
      : service('vm-103:immich', 'Immich', 'vm-103', 'ok', 'Up', 'Kuma: up', ago(8640)),
    incident
      ? service(
          'vm-103:wikijs',
          'Wiki.js',
          'vm-103',
          'unknown',
          'No signal',
          'No heartbeat yet',
          ago(2)
        )
      : service('vm-103:wikijs', 'Wiki.js', 'vm-103', 'ok', 'Up', 'Kuma: up', ago(8640)),
    service('vm-103:nextcloud', 'Nextcloud', 'vm-103', 'ok', 'Up', 'Kuma: up', ago(8640)),
    service('vm-103:home-assistant', 'Home Assistant', 'vm-103', 'ok', 'Up', 'Kuma: up', ago(8640)),
    service('vm-103:vaultwarden', 'Vaultwarden', 'vm-103', 'ok', 'Up', 'Kuma: up', ago(8640)),
    service('jagnas:adguard', 'AdGuard Home', 'jagnas', 'ok', 'Up', 'Kuma: up', ago(8640)),
  ];
  const nodes = [
    {
      id: 'nodes/vm-103',
      kind: 'node',
      subsystem: 'nodes',
      name: 'Production',
      node: 'vm-103',
      state: 'ok',
      word: 'Healthy',
      reason: 'Healthy',
      conditions: { cpu: 'ok', mem: 'ok', disk: 'ok' },
      since: ago(8640),
    },
    {
      id: 'nodes/jagnas',
      kind: 'node',
      subsystem: 'nodes',
      name: 'JagNAS',
      node: 'jagnas',
      state: incident ? 'warn' : 'ok',
      word: incident ? 'Warning' : 'Healthy',
      reason: incident ? 'Disk 92 % (warning above 90 %)' : 'Healthy',
      conditions: { cpu: 'ok', mem: 'ok', disk: incident ? 'warn' : 'ok', temp: 'ok' },
      since: ago(incident ? 200 : 8640),
    },
  ];
  const ups = {
    id: 'power/ups',
    kind: 'ups',
    subsystem: 'power',
    name: 'UPS',
    node: null,
    state: incident ? 'crit' : 'ok',
    word: incident ? 'On battery' : 'On mains',
    reason: incident ? '82 % charge · about 31 min left' : 'On mains',
    metric: { name: 'charge', value: incident ? 82 : 100, unit: '%' },
    // The model's runtime on battery, null on mains (#549); its runtime on
    // mains, load and model (#586).
    runtimeMinutes: incident ? 31 : null,
    runtimeOnMainsMinutes: incident ? null : 46,
    load: incident ? 24 : 18,
    model: 'Back-UPS 1500',
    since: ago(incident ? 2 : 8640),
  };
  const backup = {
    id: 'backups/jagnas:b2-sync',
    kind: 'backup',
    subsystem: 'backups',
    name: 'NAS → B2 backup',
    node: 'jagnas',
    state: incident ? 'warn' : 'ok',
    word: incident ? 'Overdue' : 'On time',
    reason: incident ? 'Last success 27 h ago' : 'Last run 6 h ago',
    since: ago(incident ? 200 : 360),
  };
  const entities = [...services, ...nodes, ups, backup];
  const issues = incident ? [services[0], ups, nodes[1], backup, services[1]] : [];
  // `detail` as the model words it: the value and its OK word ("4 / 6 up").
  const sub = (id, name, state, value, subLine, counts, okWord = '') => ({
    id,
    name,
    state,
    counts,
    detail: okWord ? `${value} ${okWord}` : value,
    value,
    sub: subLine,
  });
  const count = (total, ok, warn = 0, crit = 0, unknown = 0) => ({
    total,
    ok,
    warn,
    crit,
    unknown,
    maintenance: 0,
  });
  return {
    overall: incident
      ? { state: 'crit', sentence: 'Immich down · UPS on battery · 2 warnings · 1 no signal' }
      : { state: 'ok', sentence: '6 services up · 2 nodes healthy · backups on time' },
    issues,
    entities,
    subsystems: incident
      ? [
          sub(
            'services',
            'Services',
            'crit',
            '4 / 6',
            '1 down · 1 no signal',
            count(6, 4, 0, 1, 1),
            'up'
          ),
          sub('nodes', 'Nodes', 'warn', '1 / 2', '1 warning', count(2, 1, 1), 'healthy'),
          sub('power', 'Power', 'crit', 'On battery', '82 % charge', count(1, 0, 0, 1)),
          sub('jobs', 'Jobs', 'ok', '14 / 14', 'OK', count(14, 14), 'OK'),
          sub('backups', 'Backups', 'warn', '0 / 1', '1 overdue', count(1, 0, 1), 'on time'),
          sub('integrations', 'Integrations', 'ok', '9 / 9', 'OK', count(9, 9), 'OK'),
        ]
      : [
          sub('services', 'Services', 'ok', '6 / 6', 'up', count(6, 6), 'up'),
          sub('nodes', 'Nodes', 'ok', '2 / 2', 'healthy', count(2, 2), 'healthy'),
          sub('power', 'Power', 'ok', 'On mains', '100 % charge', count(1, 1)),
          sub('jobs', 'Jobs', 'ok', '14 / 14', 'OK', count(14, 14), 'OK'),
          sub('backups', 'Backups', 'ok', '1 / 1', 'on time', count(1, 1), 'on time'),
          sub('integrations', 'Integrations', 'ok', '9 / 9', 'OK', count(9, 9), 'OK'),
        ],
    sources: [],
    thresholds: THRESHOLDS,
  };
}

/** The status's clock, as useStatus serves it: built 12 s before the gallery's now. */
const updated = {
  subscribe: () => () => {},
  get: () => NOW - 12_000,
  builtAt: () => NOW - 12_000,
  staleAfter: 72_000,
};

/** A phone screen's `data` (src/shell/phoneData.js's shape) on the incident or the healthy board. */
export function phoneBoard(scenario) {
  const incident = scenario !== 'healthy';
  return {
    status: statusOf(incident),
    reach: 'ok',
    updated,
    servicesBody: servicesOf(incident),
    loading: false,
    error: null,
    freshness: { stale: false },
  };
}

/** The incident, its status gone stale: the server out of reach for 3 minutes. */
export function phoneBoardNoSignal() {
  return {
    ...phoneBoard('incident'),
    reach: 'down',
    freshness: {
      stale: true,
      cause: "Can't reach JagHelm",
      reach: 'down',
      ageText: '3 min ago',
      lastKnown: 'last known 3 min ago',
      note: 'No signal · last known 3 min ago',
    },
  };
}
