import { describe, it, expect } from 'vitest';
import { appsOf, navGroups, paletteAppsOf } from './nav.js';

// How the config's apps reach the sidebar and the palette (#362): in the
// config's order, an app that opens in a new browser tab as an outside link.
const TABS = [
  { id: 'netdata', label: 'Netdata', type: 'iframe', url: 'https://netdata.example' },
  { id: 'vault', label: 'Vaultwarden', type: 'iframe', url: 'https://vault.example', newTab: true },
  {
    id: 'kuma',
    label: 'Uptime Kuma',
    type: 'iframe',
    url: 'https://kuma.example',
    icon: 'uptime-kuma',
  },
];

const appItems = (tabs, at = {}) => {
  const apps = navGroups({
    routeId: 'overview',
    apps: appsOf(tabs),
    loaded: new Set(),
    onUnload: () => {},
    badge: null,
    ...at,
  }).find((g) => g.id === 'apps');
  return apps?.items.filter((i) => i.id.startsWith('app:')) ?? [];
};

describe('apps in the sidebar and the palette', () => {
  it('lists the apps in the config order, so reordering them reorders the sidebar', () => {
    expect(appItems(TABS).map((i) => i.label)).toEqual(['Netdata', 'Vaultwarden', 'Uptime Kuma']);
    const reordered = [TABS[2], TABS[0], TABS[1]];
    expect(appItems(reordered).map((i) => i.label)).toEqual([
      'Uptime Kuma',
      'Netdata',
      'Vaultwarden',
    ]);
  });

  it('drops a removed app from the sidebar and the palette', () => {
    const rest = TABS.filter((t) => t.id !== 'netdata');
    expect(appItems(rest).map((i) => i.label)).toEqual(['Vaultwarden', 'Uptime Kuma']);
    expect(paletteAppsOf(appsOf(rest)).map((a) => a.label)).toEqual(['Vaultwarden', 'Uptime Kuma']);
  });

  it('draws an app that opens in a new browser tab as an outside link, never loaded', () => {
    const [, vault] = appItems(TABS, { loaded: new Set(['vault']) });
    expect(vault).toMatchObject({ href: 'https://vault.example', external: true });
    expect(vault.loaded).toBeFalsy();
    expect(vault.onUnload).toBeUndefined();
  });

  it('gives an app its icon from the icon index in place of its chip', () => {
    const [netdata, , kuma] = appItems(TABS);
    expect(netdata.iconSrc).toBeUndefined();
    expect(netdata.monogram).toBe('Ne');
    expect(kuma.iconSrc).toMatch(/uptime-kuma/);
    expect(kuma.monogram).toBeUndefined();
  });

  it('gives the palette an in-app page, or the address to open in a new tab', () => {
    const [netdata, vault] = paletteAppsOf(appsOf(TABS));
    expect(netdata).toMatchObject({ id: 'netdata', label: 'Netdata', href: '/apps/netdata' });
    expect(netdata.external).toBeFalsy();
    expect(vault).toMatchObject({ id: 'vault', href: 'https://vault.example', external: true });
  });
});
