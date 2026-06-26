import { describe, it, expect } from 'vitest';
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

describe('fcmIdToIncidentId', () => {
  it('maps service events onto the derived service:<uid> id', () => {
    expect(fcmIdToIncidentId('service_down', 'vm-101:nginx')).toBe('service:vm-101:nginx');
    expect(fcmIdToIncidentId('service_recovered', 'vm-101:gitea')).toBe('service:vm-101:gitea');
  });

  it('maps cron events onto the derived cron:<node>:<job> id', () => {
    expect(fcmIdToIncidentId('cron_failed', 'vm-101:backup')).toBe('cron:vm-101:backup');
    expect(fcmIdToIncidentId('cron_recovered', 'vm-102:rotate')).toBe('cron:vm-102:rotate');
  });

  it('maps ups events onto the fixed literal ups:apcups (ignores the fcm id)', () => {
    expect(fcmIdToIncidentId('ups_on_battery', 'ups')).toBe('ups:apcups');
    expect(fcmIdToIncidentId('ups_restored', 'ups')).toBe('ups:apcups');
  });

  it('returns null for ALL host events (no derived host incident exists)', () => {
    for (const t of ['host_unreachable', 'host_recovered', 'host_threshold', 'host_threshold_cleared']) {
      expect(fcmIdToIncidentId(t, 'vm-101')).toBeNull();
      expect(fcmIdToIncidentId(t, 'vm-101:cpu')).toBeNull();
    }
  });

  it('is defensive: unknown type or missing/empty id returns null', () => {
    expect(fcmIdToIncidentId('mystery_event', 'x')).toBeNull();
    expect(fcmIdToIncidentId('service_down', '')).toBeNull();
    expect(fcmIdToIncidentId('service_down', undefined)).toBeNull();
    expect(fcmIdToIncidentId(undefined, 'x')).toBeNull();
  });
});
