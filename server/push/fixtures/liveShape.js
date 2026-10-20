/**
 * Modelled on the live install on 2026-10-19 (vm-103), by name only: the four
 * nodes in board order, the containers cAdvisor reported running on each, the
 * 26 Kuma monitors the boot line counted, and the three explicit mappings of
 * services.yaml that name monitors Kuma lacks (#342: gateway-npm,
 * gateway-tunnel and tailscale). Vaultwarden is not pinned, so it runs
 * unmonitored on pi2.
 *
 * Every node hides cadvisor, node-exporter and prometheus: no live monitor
 * matches them and the live boot line does not list them, so the live board
 * does not show them. With that, assembleServices reports UNMATCHED, the 19
 * names of the live "Containers with no matching Kuma monitor" line.
 *
 * Made up, not live: the monitor ids (this list's order), every status, the
 * metrics, the cron runs, and where the service registry last saw the monitors
 * no container has.
 *
 * `liveCycle()` assembles one refresh cycle of it, and `liveCaches()` is what
 * the services refresh leaves in the cache for the push snapshot to read. Used
 * by liveDeploy.test.js, and, at main 9d68385 (before #395), to write
 * push-snapshot-v1.json with that version's push snapshot writer.
 */
import { assembleServices } from '../../refresh.js';

export const NODE_ORDER = ['vm101', 'vm103', 'pi2', 'pi1'];

export const CONTAINERS = {
  vm101: [
    'alloy',
    'arcane-agent',
    'cadvisor',
    'code-server',
    'node-exporter',
    'nut-exporter',
    'prometheus',
  ],
  vm103: [
    'alloy',
    'arcane',
    'cadvisor',
    'collabora',
    'docker-socket-proxy',
    'gitea',
    'gitea-runner',
    'grafana',
    'homeassistant',
    'immich-machine-learning',
    'immich-postgres',
    'immich-redis',
    'immich-server',
    'jaghelm',
    'loki',
    'loki-proxy',
    'nextcloud-app',
    'nextcloud-cron',
    'nextcloud-db',
    'nextcloud-redis',
    'node-exporter',
    'nut-exporter',
    'omada-controller',
    'prometheus',
    'searxng',
    'stirling-pdf',
    'tailscale',
    'tempo',
    'uptime-kuma',
    'vaultwarden',
    'wikijs',
    'wikijs-postgres',
    'wikijs-redis',
  ],
  pi2: [
    'adguard-secondary',
    'adguard-sync',
    'alloy',
    'arcane-agent',
    'cadvisor',
    'gateway-npm',
    'gateway-tunnel',
    'haproxy',
    'node-exporter',
    'tailscale',
    'vaultwarden',
  ],
  pi1: [
    'adguard',
    'alloy',
    'arcane-agent',
    'cadvisor',
    'gateway-npm',
    'gateway-tunnel',
    'haproxy',
    'node-exporter',
  ],
};

// What every node hides (a node's `hide` in services.yaml).
export const HIDDEN = ['cadvisor', 'node-exporter', 'prometheus'];

export const MONITOR_NAMES = [
  'Gitea',
  'Immich',
  'Nextcloud',
  'Loki',
  'Wikijs',
  'Arcane',
  'Vaultwarden',
  'Adguard Primary',
  'Pi Gateway (Ping)',
  'NAS (Ping)',
  'NAS UI',
  'Network Switch',
  'Proxmox UI',
  'NPM Pi Primary',
  'NPM Pi Secondary',
  'Grafana',
  'JagHelm',
  'Adguard Secondary',
  'Collabora',
  'Home Assistant',
  'Omada Controller',
  'SearXNG',
  'Stirling-PDF',
  'Tempo',
  'Uptime Kuma',
  'VS Code Server',
];

// The monitors no container has: they are on the board only while down.
export const CONTAINERLESS = [
  'Pi Gateway (Ping)',
  'NAS (Ping)',
  'NAS UI',
  'Network Switch',
  'Proxmox UI',
  'NPM Pi Primary',
  'NPM Pi Secondary',
];

// The live boot line "Containers with no matching Kuma monitor".
export const UNMATCHED = [
  'adguard-sync',
  'alloy',
  'arcane-agent',
  'docker-socket-proxy',
  'gateway-npm',
  'gateway-tunnel',
  'gitea-runner',
  'haproxy',
  'immich-machine-learning',
  'immich-postgres',
  'immich-redis',
  'loki-proxy',
  'nextcloud-cron',
  'nextcloud-db',
  'nextcloud-redis',
  'nut-exporter',
  'tailscale',
  'wikijs-postgres',
  'wikijs-redis',
];

// The three mappings to monitors Kuma does not have (#342).
export const SERVICES_YAML = {
  'gateway-npm': { monitor: 'Nginx Proxy Manager' },
  'gateway-tunnel': { monitor: 'Cloudflared' },
  tailscale: { monitor: 'Tailscale' },
};

// Where the service registry last saw the monitors no container has.
const LAST_SEEN = {
  'Pi Gateway (Ping)': { nodeKey: 'pi2', container: 'gateway-tunnel' },
  'NAS (Ping)': { nodeKey: 'vm103', container: null },
  'NAS UI': { nodeKey: 'vm103', container: null },
  'Network Switch': { nodeKey: 'vm103', container: null },
  'Proxmox UI': { nodeKey: 'vm103', container: null },
};

export const NOW = 1_782_345_600_000;
const NODE_CFG = { display_name: 'Node', hide: HIDDEN };
const METRICS = { cpu: '12.5', memPercent: '41.0', diskPercent: '63.0' };

/**
 * One refresh cycle. `status` maps a monitor name to its Kuma status (default
 * 'up'). `order` reorders the monitors (as Kuma might list them) and each
 * node's containers (as discovery might): it is given a list and returns it in
 * the order to use.
 */
export function liveCycle({ status = {}, order = (list) => list } = {}) {
  const monitors = order(
    MONITOR_NAMES.map((name, i) => ({
      id: i + 1,
      name,
      status: status[name] ?? 'up',
      ping: 12,
      uptime24: 0.999,
      active: true,
      lastBeatAt: null,
    }))
  );
  const byId = new Map(MONITOR_NAMES.map((name, i) => [i + 1, name]));
  return assembleServices({
    nodeResults: NODE_ORDER.map((nodeKey) => [
      nodeKey,
      NODE_CFG,
      {
        metrics: METRICS,
        reachable: true,
        failedReads: [],
        containers: order(
          CONTAINERS[nodeKey].map((container) => ({ container, status: 'running', docker: {} }))
        ),
      },
    ]),
    monitors,
    config: {
      nodes: Object.fromEntries(NODE_ORDER.map((k) => [k, NODE_CFG])),
      services: SERVICES_YAML,
    },
    lastSeenNodeOf: (id) => LAST_SEEN[byId.get(Number(id))]?.nodeKey ?? null,
    lastSeenContainerOf: (id) => LAST_SEEN[byId.get(Number(id))]?.container ?? null,
    containerRegistry: null,
    now: () => NOW,
  });
}

/** The caches the push snapshot reads after `r`'s refresh (refresh.js' setCache). */
export function liveCaches(r) {
  return {
    getCached: (key) => {
      if (key === 'services') {
        return {
          nodes: r.nodes,
          overallHealth: r.overallHealth,
          sources: { prometheus: { ok: true }, kuma: { ok: true } },
        };
      }
      if (key === 'ups') return { status: 1, charge: 100, runtime: 3600, load: 20, ok: true };
      return null;
    },
    getCachedInternal: (key) =>
      key === 'services' ? { upWithoutCard: r.upWithoutCard, monitorOf: r.monitorOf } : null,
    getAllCronStatuses: () => [
      {
        node: 'vm103',
        jobs: [
          {
            job: 'restic-backup',
            runs: [{ status: 'success', timestamp: new Date(NOW - 3_600_000).toISOString() }],
          },
        ],
      },
      {
        node: 'nas',
        jobs: [
          {
            job: 'b2-sync',
            runs: [{ status: 'failure', timestamp: new Date(NOW - 7_200_000).toISOString() }],
          },
        ],
      },
    ],
    now: () => NOW,
  };
}
