import { describe, it, expect } from 'vitest';
import { toServiceCard } from './serviceCard';

const rawService = {
  display_name: 'AdGuard Home',
  container: 'adguard-home',
  status: 'running',
  uptime24: 99.9,
  ping: 12,
  icon: 'adguard.png',
  docker: { image: 'adguard/adguardhome' },
};

describe('toServiceCard', () => {
  it('projects a raw service into the flat card shape with a node:container uid', () => {
    expect(toServiceCard('pi', rawService, {})).toEqual({
      name: 'AdGuard Home',
      container: 'adguard-home',
      uid: 'pi:adguard-home',
      node: 'pi',
      status: 'running',
      uptime: 99.9,
      ping: 12,
      icon: 'adguard.png',
      docker: { image: 'adguard/adguardhome' },
      appData: null,
    });
  });

  it('attaches app-data matched by container name', () => {
    const appDataByContainer = { 'adguard-home': { Blocked: 100 } };
    expect(toServiceCard('pi', rawService, appDataByContainer).appData).toEqual({ Blocked: 100 });
  });

  it('falls back to null app-data when the container has no match', () => {
    const appDataByContainer = { 'other-container': { Blocked: 100 } };
    expect(toServiceCard('pi', rawService, appDataByContainer).appData).toBeNull();
  });

  it('defaults appDataByContainer to an empty object when omitted', () => {
    expect(toServiceCard('pi', rawService).appData).toBeNull();
  });

  it('passes monitored / source / lastSeenAt through for the unmonitored tag + breadcrumb', () => {
    const presence = {
      display_name: 'Postgres', container: 'postgres', status: 'unknown',
      monitored: false, source: 'presence', lastSeenAt: 1000,
    };
    const card = toServiceCard('vm103', presence, {});
    expect(card.monitored).toBe(false);
    expect(card.source).toBe('presence');
    expect(card.lastSeenAt).toBe(1000);
  });
});
