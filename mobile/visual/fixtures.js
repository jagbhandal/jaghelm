// Synthetic fixtures for the visual pass. Plain data; no secrets, no real hosts.
// All strings are homelab-looking placeholders — no tokens, real URLs-with-creds, or IPs.

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
  cron: [{ node: 'vm-101', jobs: [{ job: 'backup', runs: [{ status: 'success', timestamp: '2026-06-26T03:00:00Z' }] }] }],
  history: { 'vm-101:cpu': [20, 22, 21, 23, 22], 'gateway-pi:cpu': [5, 6, 6, 7, 6] },
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
  cron: [{ node: 'vm-101', jobs: [{ job: 'backup', runs: [{ status: 'failure', timestamp: '2026-06-26T03:00:00Z', error: 'Disk full on /backups' }] }] }],
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
  ups: { status: 0, charge: 76, runtime: 1200, load: 40 },
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

export const nodeDetail = degradedSubsystem;
export const incidentDetail = multiIncident;
