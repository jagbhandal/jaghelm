import { describe, it, expect } from 'vitest';
import { entityFor, entityOfRoute, entityRoute } from '@shared/phone/nav/entityRoute.js';
import { runScenario } from '../../../server/testing/statusScenarios.js';

describe('entityRoute (#309)', () => {
  it('a service or container opens Service detail by uid, a node Node detail by key', () => {
    expect(entityRoute('services/vm-101:nginx')).toEqual({
      screen: 'serviceDetail',
      params: { uid: 'vm-101:nginx' },
    });
    expect(entityRoute('services/pi-1:Home Assistant')).toEqual({
      screen: 'serviceDetail',
      params: { uid: 'pi-1:Home Assistant' },
    });
    expect(entityRoute('nodes/pve')).toEqual({ screen: 'node', params: { nodeKey: 'pve' } });
  });

  it('every other kind opens Incident detail by its id', () => {
    for (const id of [
      'power/ups',
      'jobs/vm-103:restic',
      'backups/pve:proxmox-backup',
      'integrations/immich',
      'integrations/arcane:vm-103',
      'sources/prometheus',
    ]) {
      expect(entityRoute(id), id).toEqual({ screen: 'incident', params: { id } });
    }
  });

  it('is null for what is no entity id', () => {
    for (const id of [null, undefined, '', 'ups', 'services/', '/x', 'Services/a', 42]) {
      expect(entityRoute(id), String(id)).toBeNull();
    }
  });

  it('entityOfRoute is the way back, and null for a screen that shows no entity', () => {
    for (const id of ['services/n:a', 'nodes/n', 'power/ups', 'backups/n:b', 'sources/kuma']) {
      expect(entityOfRoute(entityRoute(id)), id).toBe(id);
    }
    expect(entityOfRoute({ screen: 'overview' })).toBeNull();
    expect(entityOfRoute({ screen: 'notificationSettings', params: {} })).toBeNull();
    expect(entityOfRoute({ screen: 'serviceDetail', params: {} })).toBeNull();
    expect(entityOfRoute({ screen: 'incident', params: { id: null, fcmId: 'x' } })).toBeNull();
    expect(entityOfRoute(null)).toBeNull();
  });

  it('every entity of every kind the model has finds itself, and comes back to its id', () => {
    const { status } = runScenario('every-state', { now: Date.parse('2026-10-19T12:00:00Z') });
    expect(new Set(status.entities.map((e) => e.kind))).toEqual(
      new Set(['node', 'ups', 'container', 'service', 'job', 'backup', 'integration', 'agent'])
    );
    for (const e of [...status.entities, ...status.issues]) {
      const route = entityRoute(e.id);
      expect(route, e.id).not.toBeNull();
      expect(entityOfRoute(route), e.id).toBe(e.id);
      expect(entityFor(status, e.id), e.id).toBe(e);
    }
  });
});

describe('entityFor', () => {
  const status = {
    entities: [{ id: 'services/n:a' }, { id: 'backups/pve:proxmox-backup' }, { id: 'jobs/n:j' }],
    issues: [{ id: 'services/n:a' }, { id: 'sources/kuma' }],
  };
  it('finds an entity, or a failed source among the issues', () => {
    expect(entityFor(status, 'services/n:a')).toBe(status.entities[0]);
    expect(entityFor(status, 'sources/kuma')).toBe(status.issues[1]);
  });
  it('finds a job the model files as a backup by its job id', () => {
    expect(entityFor(status, 'jobs/pve:proxmox-backup')).toBe(status.entities[1]);
  });
  it('is null for what the model no longer has, and without a status or an id', () => {
    expect(entityFor(status, 'services/gone')).toBeNull();
    expect(entityFor(status, 'jobs/n:gone')).toBeNull();
    expect(entityFor(null, 'services/n:a')).toBeNull();
    expect(entityFor(status, '')).toBeNull();
    expect(entityFor(status, undefined)).toBeNull();
  });
});
