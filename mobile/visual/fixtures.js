// The boards the Android screenshots draw (#546, android.spec.mjs). Plain data:
// homelab-looking placeholders, no secrets, real hosts or IPs. The server's
// answers are built from them by the server's own status model (backendOf).
import {
  NOW,
  NO_UPS,
  cronNode,
  cronRun,
  inputs,
  once,
} from '../../server/testing/statusFixtures.js';

const HOUR = 3_600_000;

export const calm = {
  services: {
    nodes: {
      'vm-101': {
        display_name: 'VM 101',
        subtitle: 'app',
        metrics: { cpu: '22.4', memPercent: '38.1', diskPercent: '41.0', diskUnit: 'GB', temp: null },
        services: [
          { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'up', ping: 8, uptime24: 0.999, url: 'http://example/gitea', docker: { cpu: 2, memMB: 180 } },
          { uid: 'vm-101:grafana', container: 'grafana', display_name: 'Grafana', icon: null, status: 'up', ping: 11, uptime24: 0.998, url: 'http://example/grafana', docker: { cpu: 1, memMB: 90 } },
        ],
      },
      'gateway-pi': {
        display_name: 'Gateway Pi',
        subtitle: 'edge',
        metrics: { cpu: '6.0', memPercent: '30.0', temp: '48.2', diskPercent: '18.0' },
        services: [
          { uid: 'gateway-pi:pihole', container: 'pihole', display_name: 'Pi-hole', icon: null, status: 'up', ping: 3, uptime24: 1, url: 'http://example/pihole', docker: null },
        ],
      },
    },
  },
  ups: { status: 1, charge: 100, runtime: 3600, load: 22 },
  cron: [cronNode('vm-101', { backup: cronRun('success', 21 * HOUR) })],
};

export const degradedSubsystem = {
  ...calm,
  services: {
    nodes: {
      ...calm.services.nodes,
      'vm-101': {
        ...calm.services.nodes['vm-101'],
        services: [
          { ...calm.services.nodes['vm-101'].services[0], status: 'down', ping: null, uptime24: 0.44 },
          calm.services.nodes['vm-101'].services[1],
        ],
      },
    },
  },
  cron: [cronNode('vm-101', { backup: cronRun('failure', 21 * HOUR, { error: 'Disk full on /backups' }) })],
};

export const multiIncident = {
  ...calm,
  services: {
    nodes: {
      'vm-101': {
        ...calm.services.nodes['vm-101'],
        services: [
          { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.42, url: 'http://example/gitea', docker: null },
          { uid: 'vm-101:grafana', container: 'grafana', display_name: 'Grafana', icon: null, status: 'down', ping: null, uptime24: 0.61, url: 'http://example/grafana', docker: null },
          { uid: 'vm-101:nextcloud', container: 'nextcloud', display_name: 'Nextcloud', icon: null, status: 'down', ping: null, uptime24: 0.73, url: 'http://example/nc', docker: null },
        ],
      },
    },
  },
  ups: { status: 2, charge: 76, runtime: 1200, load: 40 },
};

export const downService = {
  ...calm,
  services: {
    nodes: {
      ...calm.services.nodes,
      'vm-101': {
        ...calm.services.nodes['vm-101'],
        services: [
          { uid: 'vm-101:gitea', container: 'gitea', display_name: 'Gitea', icon: null, status: 'down', ping: null, uptime24: 0.44, url: 'http://example/gitea', docker: null },
          calm.services.nodes['vm-101'].services[1],
        ],
      },
    },
  },
};

// A first run (#449): nothing monitored, no UPS, no jobs.
export const empty = {
  services: { nodes: {} },
  ups: NO_UPS,
  cron: [],
};

/** When the server built every status here, and the clock the screens read. */
export { NOW };

/**
 * What the server answers for `board`, by path under /api: the cards as the
 * refresh leaves them (each node reachable, each card its Kuma monitor's), the
 * status the model builds from them at NOW, the UPS's readings and the
 * refresh cadence.
 */
export function backendOf(board) {
  const nodes = Object.fromEntries(
    Object.entries(board.services.nodes).map(([key, node]) => [
      key,
      {
        reachable: true,
        failedReads: [],
        ...node,
        services: node.services.map((svc) => ({ monitored: true, source: 'container', ...svc })),
      },
    ])
  );
  const cycle = inputs({
    nodes,
    ups: { ok: true, configured: true, model: 'UPS', ...board.ups },
    cron: board.cron,
  });
  return {
    '/status': JSON.parse(JSON.stringify(once(cycle))),
    '/services': cycle.services,
    '/ups': cycle.ups,
    '/display-config': { refreshInterval: 30 },
  };
}
