/**
 * Status-model fixtures for the web's tests (#296): each is what the server's
 * own model (server/status/model.js) builds from a homelab-shaped cycle, so
 * the shell is tested against the real shape and sentences, never a
 * hand-written copy that could drift. (The Playwright shell tests, e2e/, use
 * the demo's own /api/status, which the same model builds.)
 */
import {
  card,
  inputs,
  monitored,
  node,
  once,
  UPS_ONLINE,
} from '../../server/testing/statusFixtures.js';
import { scenarioStatus } from '../../server/testing/statusScenarios.js';
import { demoHistory, demoStatusCycles } from '../../server/demoFixtures.js';
import {
  createStatusTracker,
  readStatusInputs,
  resolveThresholds,
} from '../../server/status/index.js';

const services = (nodeName, list) =>
  list.map(([name, status]) =>
    monitored(`${nodeName}:${name.toLowerCase()}`, status, { display_name: name })
  );

/** An incident: a service down, the UPS on battery, a disk warning and a node with no signal. */
export const INCIDENT = once(
  inputs({
    nodes: {
      vm103: node(
        { diskPercent: '92.0' },
        {
          display_name: 'vm103',
          services: services('vm103', [
            ['Immich', 'down'],
            ['Nextcloud', 'up'],
          ]),
        }
      ),
      pi: node({}, { display_name: 'pi', failedReads: ['reachable'] }),
    },
    ups: { ...UPS_ONLINE, status: 2, charge: 82 },
  })
);

/** All well: the quiet line. */
export const HEALTHY = once(
  inputs({
    nodes: {
      vm103: node({}, { display_name: 'vm103', services: services('vm103', [['Immich', 'up']]) }),
      pve: node({}, { display_name: 'pve' }),
    },
  })
);

/** Only a warning: a disk over its line. */
export const DEGRADED = once(
  inputs({
    nodes: {
      vm103: node(
        { diskPercent: '91.0' },
        { display_name: 'vm103', services: services('vm103', [['Immich', 'up']]) }
      ),
    },
  })
);

/** Nothing wrong but a node with no signal. */
export const NO_SIGNAL = once(
  inputs({
    nodes: {
      vm103: node({}, { display_name: 'vm103', services: services('vm103', [['Immich', 'up']]) }),
      pi: node({}, { display_name: 'pi', failedReads: ['reachable'] }),
    },
  })
);

/**
 * A first run, nothing set up: the cross-client suite's `first-run` fixture
 * (server/testing/statusScenarios.js), an empty board (#449).
 */
export const FIRST_RUN = scenarioStatus('first-run', { now: Date.parse('2026-10-20T09:00:00Z') });

/**
 * A demo board as a client gets it (#299): `/api/status`, `/api/services` and
 * the node cards' `/api/history?series=node.cpu&range=1h` (#311), built as the demo builds them (demoFixtures.js), with the
 * storage node's metrics replaced by `storage` (strings, as discovery formats
 * them), the services in `down` (by uid, "apps:gitea") down as Kuma reports a
 * failed check (#484), and the lines from `pushThresholds` when given. The
 * status goes through the model, never written by hand, so it says what the
 * model says.
 *
 * @param {{ scenario?: 'incident' | 'healthy', storage?: Record<string, string>,
 *   down?: string[], pushThresholds?: object, now?: number }} [opts]
 */
export function demoBoard({
  scenario = 'incident',
  storage = {},
  down = [],
  pushThresholds,
  now = Date.now(),
} = {}) {
  const tracker = createStatusTracker();
  let status = null;
  let services = null;
  const isDown = new Set(down);
  for (const cycle of demoStatusCycles({ scenario, now })) {
    const base = cycle.caches.getCached('services');
    const nodes = Object.fromEntries(
      Object.entries(base.nodes).map(([key, node]) => [
        key,
        {
          ...node,
          services: node.services.map((svc) =>
            isDown.has(svc.uid) ? { ...svc, status: 'down', ping: null } : svc
          ),
        },
      ])
    );
    services = {
      ...base,
      nodes: {
        ...nodes,
        storage: { ...nodes.storage, metrics: { ...nodes.storage.metrics, ...storage } },
      },
    };
    const caches = {
      ...cycle.caches,
      getCached: (key) => (key === 'services' ? services : cycle.caches.getCached(key)),
    };
    status = tracker.update({
      inputs: readStatusInputs(caches, cycle.extra),
      thresholds: pushThresholds ? resolveThresholds(pushThresholds) : cycle.thresholds,
      now: cycle.now,
    });
  }
  // As a client reads them: JSON.
  const history = demoHistory({ query: { series: 'node.cpu', range: '1h' }, now }).body;
  return JSON.parse(JSON.stringify({ status, services, history }));
}

/**
 * The incident on the Infrastructure section (#299): the demo's incident with
 * its NAS (the storage node) at 94.6 % disk, under the 95 % crit line, so a
 * warning that reads 94, on the meter and in the model's reason alike (#450).
 */
export const nasDiskIncident = (opts = {}) =>
  demoBoard({ ...opts, scenario: 'incident', storage: { diskPercent: '94.6' } });

/**
 * A real incident's length (#484): the demo's incident (Jellyfin down, the
 * nightly backup failed) with four more services down, so six issues, all
 * critical, each a place on the board. Below 768px the strip must stay on
 * screen above them.
 */
export const sixIssueIncident = (opts = {}) =>
  demoBoard({
    ...opts,
    scenario: 'incident',
    down: ['apps:gitea', 'apps:nextcloud', 'edge:adguard-home', 'storage:photoprism'],
  });

/**
 * Two Pis that each run AdGuard Home under the same container name, and a
 * Kuma monitor no container answers to (#517): the services a custom group
 * must tell apart. `{ status, services, serverConfig }`, as a client reads
 * them (/api/status, /api/services, /api/services/config). With `pi2Unread`,
 * pi-2's container list wasn't read this cycle: its AdGuard Home and its
 * Unbound are in neither list.
 */
export function twoPis({ pi2Unread = false } = {}) {
  const adguard = (uid) => monitored(uid, 'up', { display_name: 'AdGuard Home' });
  const pi2 = pi2Unread
    ? { display_name: 'Pi 2', failedReads: ['containers'] }
    : {
        display_name: 'Pi 2',
        services: [adguard('pi-2:adguard-home'), card('pi-2:unbound', { display_name: 'Unbound' })],
      };
  const cycle = inputs({
    nodes: {
      'pi-1': node({}, { display_name: 'Pi 1', services: [adguard('pi-1:adguard-home')] }),
      'pi-2': node({}, pi2),
    },
    internal: { upWithoutCard: ['pi-1:Home Assistant'] },
  });
  const serverConfig = {
    nodes: { 'pi-1': { display_name: 'Pi 1' }, 'pi-2': { display_name: 'Pi 2' } },
  };
  return JSON.parse(
    JSON.stringify({ status: once(cycle), services: cycle.services, serverConfig })
  );
}
