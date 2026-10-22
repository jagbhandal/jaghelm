/**
 * Test-only: the `data` a screen gets from MobileApp (useDashboard plus the
 * status's freshness), built by the server's own status model, never status
 * JSON written by hand, so a screen test can only draw what the model says
 * (server/testing/statusFixtures.js builds the inputs).
 */
import { once } from '../../../server/testing/statusFixtures.js';

export {
  card,
  cronNode,
  cronRun,
  inputs,
  missing,
  monitored,
  node,
  NO_UPS,
  UPS_ONLINE,
} from '../../../server/testing/statusFixtures.js';

/** What a stale status looks like to a screen: statusFreshness.js's shape, "Can't reach JagHelm". */
export const STALE = Object.freeze({
  stale: true,
  ageText: '3 min ago',
  lastKnown: 'last known 3 min ago',
  note: 'No signal · last known 3 min ago',
  cause: "Can't reach JagHelm",
  reach: 'down',
});

/**
 * A screen's `data` for one model cycle's inputs: /api/status (as JSON, as a
 * client gets it) and the /api/services cards and /api/ups readings the inputs
 * carry, fresh, with `extra` laid over it.
 */
export function boardOf(cycleInputs, extra = {}) {
  return {
    status: JSON.parse(JSON.stringify(once(cycleInputs))),
    servicesBody: JSON.parse(JSON.stringify(cycleInputs.services)),
    ups: JSON.parse(JSON.stringify(cycleInputs.ups ?? null)),
    reach: 'ok',
    freshness: { stale: false },
    loading: false,
    error: null,
    ...extra,
  };
}
