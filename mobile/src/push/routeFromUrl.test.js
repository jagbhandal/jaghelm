import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeFromUrl } from './routeFromUrl.js';
import { routeFromData } from './routeFromData.js';
vi.mock('./routeFromData.js', () => ({ routeFromData: vi.fn() }));

describe('routeFromUrl', () => {
  beforeEach(() => {
    vi.mocked(routeFromData).mockClear();
  });

  it('parses jaghelm://incident/<id> with query params into the data shape and delegates', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://incident/vm-101%3Anginx?type=service_down&node=vm-101&severity=critical', nav);
    expect(routeFromData).toHaveBeenCalledWith(
      { type: 'service_down', id: 'vm-101:nginx', node: 'vm-101', severity: 'critical' },
      nav,
    );
  });

  it('parses a host deep link (colon-less id)', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://incident/vm-101?type=host_unreachable&node=vm-101&severity=critical', nav);
    expect(routeFromData).toHaveBeenCalledWith(
      { type: 'host_unreachable', id: 'vm-101', node: 'vm-101', severity: 'critical' },
      nav,
    );
  });

  it('carries an entity id (#309) when the link names one', () => {
    const nav = { push: vi.fn() };
    routeFromUrl(
      'jaghelm://incident/pve%3Aproxmox-backup?type=cron_failed&node=pve&severity=critical&entity=backups%2Fpve%3Aproxmox-backup',
      nav,
    );
    expect(routeFromData).toHaveBeenCalledWith(
      {
        type: 'cron_failed',
        id: 'pve:proxmox-backup',
        node: 'pve',
        severity: 'critical',
        entity: 'backups/pve:proxmox-backup',
      },
      nav,
    );
  });

  it('is defensive: a non-incident or id-less url does NOT delegate', () => {
    const nav = { push: vi.fn() };
    routeFromUrl('jaghelm://settings', nav);
    routeFromUrl('https://example.com/incident/x', nav);
    routeFromUrl('jaghelm://incident/', nav);
    routeFromUrl('', nav);
    routeFromUrl(undefined, nav);
    expect(routeFromData).not.toHaveBeenCalled();
  });
});
