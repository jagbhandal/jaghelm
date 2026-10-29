/**
 * Drive health fixtures for the client's tests and the gallery (#728): drive
 * records in the shape server/drives.js gives the status model, and the
 * model's own status for a NAS over them (server/status/model.js builds it, so
 * every state, word and reason on screen is the server's). No serial numbers:
 * no record has one.
 */
import { card, cycles, entityOf, inputs, node } from '../../server/testing/statusFixtures.js';

const zero = { count: 0, grew: false };

/** A healthy spinning SATA drive; `over` replaces fields. */
export const hdd = (device = 'sda', over = {}) => ({
  device,
  model: 'ST8000VN004',
  type: 'hdd',
  smartPassed: true,
  criticalWarning: null,
  availableSpare: null,
  spareThreshold: null,
  percentageUsed: null,
  temperature: 40,
  powerOnSeconds: 20_746_800,
  exitStatus: 0,
  mediaErrors: null,
  sectors: { reallocated: zero, pending: zero, uncorrectable: zero },
  ...over,
});

/** A healthy NVMe. */
export const nvme = (device = 'nvme0', over = {}) => ({
  device,
  model: 'CT1000P310SSD8',
  type: 'nvme',
  smartPassed: true,
  criticalWarning: 0,
  availableSpare: 100,
  spareThreshold: 5,
  percentageUsed: 2,
  temperature: 31,
  powerOnSeconds: 19_674_000,
  exitStatus: 0,
  mediaErrors: zero,
  sectors: null,
  ...over,
});

/** SATA sector counts, `over` replacing some ({ reallocated: { count: 3, grew: true } }). */
export const sectors = (over = {}) => ({
  reallocated: zero,
  pending: zero,
  uncorrectable: zero,
  ...over,
});

const read = (drives, extra = {}) => ({
  enabled: true,
  nodes: { nas: { devices: drives.length, scrapeUp: true, drives, ...extra } },
});

const nas = () => node({}, { display_name: 'UGREEN NAS', services: [card('nas:jellyfin')] });

/**
 * The model's status for node `nas` with these drives after `cycles` cycles:
 * `{ status, entity }`, the node's entity being what the drawer and the
 * phone's sheet draw. `blind`: the cycle after, the exporter's series gone.
 */
export function nasWith(drives, { blind = false } = {}) {
  const before = inputs({ nodes: { nas: nas() }, drives: read(drives) });
  const list = blind
    ? [before, inputs({ nodes: { nas: nas() }, drives: { enabled: true, nodes: {} } })]
    : [before];
  const status = cycles(list).at(-1);
  return { status, entity: entityOf(status, 'nodes/nas') };
}

/** The status of a node with no drive data at all: today's. */
export function nasWithoutDrives() {
  const status = cycles([inputs({ nodes: { nas: nas() } })])[0];
  return { status, entity: entityOf(status, 'nodes/nas') };
}
