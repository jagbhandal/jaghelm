import { describe, it, expect } from 'vitest';
import { fcmIdToIncidentId } from './fcmIdToIncidentId.js';

// A push's FCM data → the status model's entity id, which Incident detail
// looks the issue up by (#325).
describe('fcmIdToIncidentId', () => {
  it('maps service events onto services/<uid>', () => {
    expect(fcmIdToIncidentId('service_down', 'vm-101:nginx')).toBe('services/vm-101:nginx');
    expect(fcmIdToIncidentId('service_recovered', 'vm-101:gitea')).toBe('services/vm-101:gitea');
  });

  it('maps cron events onto jobs/<node>:<job> (issueFor finds a backup by it too)', () => {
    expect(fcmIdToIncidentId('cron_failed', 'vm-101:backup')).toBe('jobs/vm-101:backup');
    expect(fcmIdToIncidentId('cron_recovered', 'vm-102:rotate')).toBe('jobs/vm-102:rotate');
  });

  it('maps ups events onto power/ups (ignores the fcm id)', () => {
    expect(fcmIdToIncidentId('ups_on_battery', 'ups')).toBe('power/ups');
    expect(fcmIdToIncidentId('ups_restored', 'ups')).toBe('power/ups');
  });

  it('maps host events onto their node, nodes/<node>, from data.node or the id', () => {
    for (const t of ['host_unreachable', 'host_recovered', 'host_threshold', 'host_threshold_cleared']) {
      expect(fcmIdToIncidentId(t, 'vm-101', 'vm-101')).toBe('nodes/vm-101');
      expect(fcmIdToIncidentId(t, 'vm-101:cpu', 'vm-101')).toBe('nodes/vm-101');
      expect(fcmIdToIncidentId(t, 'vm-101:pool:local-lvm')).toBe('nodes/vm-101');
    }
  });

  it('maps a monitoring source (or the config) onto sources/<name>', () => {
    expect(fcmIdToIncidentId('source_down', 'prometheus', 'prometheus')).toBe('sources/prometheus');
    expect(fcmIdToIncidentId('source_down', 'config', 'config')).toBe('sources/config');
  });

  it('is defensive: an Arcane or unknown type, or a missing/empty id, returns null', () => {
    expect(fcmIdToIncidentId('arcane_agent_offline', 'apps')).toBeNull();
    expect(fcmIdToIncidentId('mystery_event', 'x')).toBeNull();
    expect(fcmIdToIncidentId('service_down', '')).toBeNull();
    expect(fcmIdToIncidentId('service_down', undefined)).toBeNull();
    expect(fcmIdToIncidentId(undefined, 'x')).toBeNull();
  });
});
