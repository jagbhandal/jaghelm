import { describe, it, expect, vi } from 'vitest';
import { routeFromData } from './routeFromData.js';

// A tapped push opens the detail screen of the entity it is about (#309):
// the push's `entity`, the status model's id, else its id reconciled onto one
// (an older server's push, #325). A service opens Service detail, a node Node
// detail, anything else Incident detail, which keeps the push's own fields
// for an event that is no entity now.
const tap = (data) => {
  const nav = { push: vi.fn() };
  routeFromData(data, nav);
  return nav.push;
};

describe('routeFromData', () => {
  it('a service push opens Service detail by its uid', () => {
    const push = tap({
      type: 'service_down',
      id: 'vm-101:nginx',
      node: 'vm-101',
      severity: 'critical',
      entity: 'services/vm-101:nginx',
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:nginx' });
  });

  it('a host push, a reading’s too, opens Node detail by its node', () => {
    expect(
      tap({ type: 'host_unreachable', id: 'vm-101', node: 'vm-101', severity: 'critical', entity: 'nodes/vm-101' })
    ).toHaveBeenCalledWith('node', { nodeKey: 'vm-101' });
    expect(
      tap({ type: 'host_threshold', id: 'vm-101:cpu', node: 'vm-101', severity: 'warning', entity: 'nodes/vm-101' })
    ).toHaveBeenCalledWith('node', { nodeKey: 'vm-101' });
  });

  it('the UPS, a job, a backup, a source and an Arcane agent open Incident detail by the entity, with the push’s fields', () => {
    const cases = [
      [{ type: 'ups_on_battery', id: 'ups', node: 'ups', severity: 'critical' }, 'power/ups'],
      [{ type: 'cron_failed', id: 'vm-101:sync', node: 'vm-101', severity: 'warning' }, 'jobs/vm-101:sync'],
      [{ type: 'cron_failed', id: 'pve:proxmox-backup', node: 'pve', severity: 'critical' }, 'backups/pve:proxmox-backup'],
      [{ type: 'source_down', id: 'kuma', node: 'kuma', severity: 'warning' }, 'sources/kuma'],
      [{ type: 'arcane_agent_offline', id: 'arcane:vm-103:agent', node: 'vm-103', severity: 'warning' }, 'integrations/arcane:vm-103'],
    ];
    for (const [data, entity] of cases) {
      expect(tap({ ...data, entity }), entity).toHaveBeenCalledWith('incident', {
        id: entity,
        fcmId: data.id,
        type: data.type,
        node: data.node,
        severity: data.severity,
      });
    }
  });

  it('an older server’s push, with no entity, reconciles its id onto the same entities', () => {
    expect(tap({ type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' }))
      .toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:nginx' });
    expect(tap({ type: 'host_threshold', id: 'vm-101:cpu', node: 'vm-101', severity: 'warning' }))
      .toHaveBeenCalledWith('node', { nodeKey: 'vm-101' });
    expect(tap({ type: 'cron_failed', id: 'vm-101:backup', node: 'vm-101', severity: 'warning' }))
      .toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'jobs/vm-101:backup', fcmId: 'vm-101:backup' }));
    expect(tap({ type: 'ups_on_battery', id: 'ups', node: 'ups', severity: 'critical' }))
      .toHaveBeenCalledWith('incident', expect.objectContaining({ id: 'power/ups', fcmId: 'ups' }));
  });

  it('a push about no entity (an Arcane update) opens Incident detail from its own fields', () => {
    expect(tap({ type: 'arcane_update', id: 'arcane:vm-103:update', node: 'vm-103', severity: 'info' }))
      .toHaveBeenCalledWith('incident', {
        id: null,
        fcmId: 'arcane:vm-103:update',
        type: 'arcane_update',
        node: 'vm-103',
        severity: 'info',
      });
  });

  it('an entity that is no entity id is ignored for the push’s own id', () => {
    expect(tap({ type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical', entity: 'nonsense' }))
      .toHaveBeenCalledWith('serviceDetail', { uid: 'vm-101:nginx' });
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
    expect(tap({ type: 'ups_on_battery', id: 'ups', severity: 'critical' })).toHaveBeenCalledWith('incident', {
      id: 'power/ups',
      fcmId: 'ups',
      type: 'ups_on_battery',
      node: undefined,
      severity: 'critical',
    });
  });
});
