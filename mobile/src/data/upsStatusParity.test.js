import { describe, it, expect } from 'vitest';
import { upsState } from './derive.js';
import { normalizeUpsStatus } from '../../../server/push/snapshot.js';

// The app keeps its own copy of the nut_status map because it can't bundle
// server code. This holds the copy to the server's (normalizeUpsStatus in
// server/push/snapshot.js: how push reads a nut_status, through the status
// model's UPS rule since #292), so a change to either side fails here instead
// of drifting (#273).

// /api/ups sends nut_status as a number or null (parseFloat of the Prometheus
// sample in server/refresh.js), so the probes cover that domain: every value
// NUT defines, its neighbours, and the non-finite and missing readings.
// normalizeUpsStatus also maps the strings 'online' and 'on_battery' to
// themselves; those are deliberately left out because they can't arrive over
// /api/ups (the server's string branch serves snapshot states only).
const PROBES = [
  -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1.5, -0,
  Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined,
];

describe('UPS nut_status map matches server/push/snapshot.js', () => {
  it.each(PROBES)('nut_status %s', (status) => {
    expect(upsState({ status })).toBe(normalizeUpsStatus(status));
  });

  it('agrees on the values NUT defines: 0 unknown, 1 online, 2 and 3 on battery', () => {
    expect([0, 1, 2, 3].map((status) => upsState({ status }))).toEqual(['unknown', 'online', 'on_battery', 'on_battery']);
    expect([0, 1, 2, 3].map(normalizeUpsStatus)).toEqual(['unknown', 'online', 'on_battery', 'on_battery']);
  });
});
