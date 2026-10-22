import { describe, it, expect, vi } from 'vitest';
import { routeFromData } from './routeFromData.js';

describe('routeFromData', () => {
  it('routes a live service_down to the RECONCILED services/<uid> id (so the live issue matches)', () => {
    const nav = { push: vi.fn() };
    routeFromData(
      { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' },
      nav,
    );
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: 'services/vm-101:nginx', // RECONCILED, not the raw data.id
      fcmId: 'vm-101:nginx',
      type: 'service_down',
      node: 'vm-101',
      severity: 'critical',
    });
  });

  it('reconciles cron and ups ids onto the model\'s entity ids', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'cron_failed', id: 'vm-101:backup', node: 'vm-101', severity: 'warning' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'jobs/vm-101:backup', fcmId: 'vm-101:backup' }));
    const nav2 = { push: vi.fn() };
    routeFromData({ type: 'ups_on_battery', id: 'ups', node: 'ups', severity: 'critical' }, nav2);
    expect(nav2.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'power/ups', fcmId: 'ups' }));
  });

  it('host events push their node\'s id, nodes/<node>, and keep fcmId/type/node for the fallback', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'host_unreachable', id: 'vm-101', node: 'vm-101', severity: 'critical' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: 'nodes/vm-101',
      fcmId: 'vm-101',
      type: 'host_unreachable',
      node: 'vm-101',
      severity: 'critical',
    });
    const nav2 = { push: vi.fn() };
    routeFromData({ type: 'host_threshold', id: 'vm-101:cpu', node: 'vm-101', severity: 'warning' }, nav2);
    expect(nav2.push).toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'nodes/vm-101', fcmId: 'vm-101:cpu', type: 'host_threshold' }));
  });

  it('is defensive: missing/null data or missing id does NOT push (no crash)', () => {
    const nav = { push: vi.fn() };
    routeFromData(null, nav);
    routeFromData(undefined, nav);
    routeFromData({}, nav);
    routeFromData({ type: 'service_down', id: '', node: 'n', severity: 'critical' }, nav);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('tolerates an absent node (passes through whatever is sent)', () => {
    const nav = { push: vi.fn() };
    routeFromData({ type: 'service_down', id: 'vm-101:nginx', severity: 'critical' }, nav);
    expect(nav.push).toHaveBeenCalledWith('incident', {
      id: 'services/vm-101:nginx',
      fcmId: 'vm-101:nginx',
      type: 'service_down',
      node: undefined,
      severity: 'critical',
    });
  });
});
