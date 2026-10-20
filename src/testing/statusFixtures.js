/**
 * Status-model fixtures for the web's tests (#296): each is what the server's
 * own model (server/status/model.js) builds from a homelab-shaped cycle, so
 * the shell is tested against the real shape and sentences, never a
 * hand-written copy that could drift. (The Playwright shell tests, e2e/, use
 * the demo's own /api/status, which the same model builds.)
 */
import {
  inputs,
  monitored,
  node,
  once,
  UPS_ONLINE,
} from '../../server/testing/statusFixtures.js';
import { scenarioStatus } from '../../server/testing/statusScenarios.js';

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
