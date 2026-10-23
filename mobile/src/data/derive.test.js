import { describe, it, expect } from 'vitest';
import * as derive from '@shared/phone/data/derive.js';
import { flattenServices, formatClock, uptimePct } from '@shared/phone/data/derive.js';

// derive.js holds display helpers only (#325): every state the app shows is
// the status model's. noSeverity.test.js guards the rest of mobile/src/.
describe('derive.js: display helpers only', () => {
  it('exports nothing but its display helpers: no severity, threshold or state of its own', () => {
    expect(Object.keys(derive).sort()).toEqual([
      'flattenServices',
      'formatClock',
      'uptimePct',
    ]);
  });
});

const SERVICES_BODY = {
  nodes: {
    'vm-101': {
      display_name: 'VM 101',
      services: [
        { uid: 'vm-101:adguard', display_name: 'AdGuard', status: 'up' },
        { uid: 'vm-101:gitea', display_name: 'Gitea', status: 'down' },
      ],
    },
    'gateway-pi': {
      services: [{ uid: 'gateway-pi:pihole', display_name: 'Pi-hole', status: 'unknown' }],
    },
  },
};

describe('flattenServices', () => {
  it('flattens and attaches nodeKey/nodeName, the node key when it has no display name', () => {
    const flat = flattenServices(SERVICES_BODY);
    expect(flat.map((s) => [s.uid, s.nodeKey, s.nodeName])).toEqual([
      ['vm-101:adguard', 'vm-101', 'VM 101'],
      ['vm-101:gitea', 'vm-101', 'VM 101'],
      ['gateway-pi:pihole', 'gateway-pi', 'gateway-pi'],
    ]);
  });
  it('tolerates a null/empty body', () => {
    expect(flattenServices(null)).toEqual([]);
    expect(flattenServices({ nodes: {} })).toEqual([]);
  });
});

describe('uptimePct', () => {
  it('formats a 0–1 scalar as a one-decimal percent; null stays null', () => {
    expect(uptimePct(0.9994)).toBe('99.9');
    expect(uptimePct(null)).toBeNull();
  });
});

describe('formatClock', () => {
  const TS = 1700000000000;
  const d = new Date(TS);
  const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  it('formats an epoch-ms number → HH:MM', () => expect(formatClock(TS)).toBe(expected));
  it('formats a numeric string (as FCM delivers)', () => expect(formatClock(String(TS))).toBe(expected));
  it('formats an ISO string', () => expect(formatClock(d.toISOString())).toBe(expected));
  it('null-safe: null/empty/garbage/NaN → null', () => {
    expect(formatClock(null)).toBeNull();
    expect(formatClock('')).toBeNull();
    expect(formatClock(undefined)).toBeNull();
    expect(formatClock('not a date')).toBeNull();
    expect(formatClock(NaN)).toBeNull();
  });
});
