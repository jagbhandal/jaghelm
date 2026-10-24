/**
 * Test-only: Jag's vm-103 as the server draws it with Compose stacks (#642):
 * the real assembleServices() and status model over his containers (Immich 4,
 * Nextcloud 5 with Collabora its own row, Wiki.js 3, Loki 2, singles) and the
 * Kuma monitors that lead them. The client tests and the browser tests read
 * its `status` and `services` as a client gets them.
 *
 * `redis` is what Immich's Redis is doing: 'up', 'down' (a port monitor of its
 * own, which Kuma reports down: it is no web address, so Redis stays inside
 * the stack) or 'stopped' (it left the container list; the registry remembers
 * it and its project).
 */
import { assembleServices } from '../refresh.js';
import { cachesOfAssembled, snapshotAfter } from './pushPipeline.js';

const ctr = (container, project) => ({
  container,
  status: 'running',
  docker: { cpu: 1, memMB: 100 },
  ...(project ? { project } : {}),
  ...(project ? { image: `example.com/${container}:latest` } : {}),
});

const web = (id, name) => ({
  id,
  name,
  type: 'http',
  status: 'up',
  kumaStatus: 'up',
  ping: 60 + id,
  uptime24: 1,
  active: true,
});

const MAP = {
  immich_server: { monitor: 'Immich' },
  'nextcloud-app': { monitor: 'Nextcloud' },
  collabora: { monitor: 'Collabora' },
  wikijs: { monitor: 'Wiki.js', display_name: 'Wiki.js' },
  gitea: { monitor: 'Gitea' },
};

export const STACK_NOW = Date.parse('2026-10-24T14:08:00Z');

/** @param {{ redis?: 'up' | 'down' | 'stopped', stacks?: object }} [opts] */
export function stackBoard({ redis = 'up', stacks } = {}) {
  const containers = [
    ctr('immich_server', 'immich'),
    ctr('immich_machine_learning', 'immich'),
    ctr('immich_postgres', 'immich'),
    ...(redis === 'stopped' ? [] : [ctr('immich_redis', 'immich')]),
    ctr('nextcloud-app', 'nextcloud'),
    ctr('nextcloud-cron', 'nextcloud'),
    ctr('nextcloud-db', 'nextcloud'),
    ctr('nextcloud-redis', 'nextcloud'),
    ctr('collabora', 'nextcloud'),
    ctr('wikijs', 'wikijs'),
    ctr('wikijs-db', 'wikijs'),
    ctr('wikijs-git', 'wikijs'),
    ctr('loki', 'loki'),
    ctr('loki-proxy', 'loki'),
    ctr('gitea', 'gitea'),
    ctr('grafana'),
  ];
  const monitors = {
    1: web(1, 'Immich'),
    2: web(2, 'Nextcloud'),
    3: web(3, 'Collabora'),
    4: web(4, 'Wiki.js'),
    5: web(5, 'Gitea'),
  };
  const services = { ...MAP };
  if (redis === 'down') {
    monitors[6] = {
      ...web(6, 'Immich Redis'),
      type: 'port',
      status: 'down',
      kumaStatus: 'down',
      ping: null,
    };
    services.immich_redis = { monitor: 'Immich Redis' };
  }
  const registry =
    redis === 'stopped'
      ? {
          recordSeen() {},
          getMissing: () => [
            {
              container: 'immich_redis',
              lastSeenNode: 'vm103',
              lastSeenAt: STACK_NOW - 600_000,
              ageMs: 600_000,
              project: 'immich',
            },
          ],
        }
      : null;
  const assembled = assembleServices({
    nodeResults: [
      [
        'vm103',
        { display_name: 'Production' },
        {
          reachable: true,
          metrics: { cpu: '5', memPercent: '10', diskPercent: '10' },
          containers,
        },
      ],
    ],
    monitors,
    config: { services, stacks },
    lastSeenNodeOf: () => null,
    lastSeenContainerOf: () => null,
    containerRegistry: registry,
    now: () => STACK_NOW,
  });
  const caches = cachesOfAssembled(assembled);
  const { status } = snapshotAfter(caches, null, { now: STACK_NOW });
  // As a client reads them: JSON.
  return JSON.parse(JSON.stringify({ status, services: caches.getCached('services') }));
}
