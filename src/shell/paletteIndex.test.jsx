import { describe, it, expect, vi } from 'vitest';
import { paletteIndex, paletteSearch } from './paletteIndex.js';
import { MOVED_SECTIONS, SETTINGS_SECTIONS } from '../components/settings/sections.js';
import { scenarioStatus } from '../../server/testing/statusScenarios.js';

// What the command palette finds (#315): the model's issues and entities, the
// pages, the apps, Settings' sections and the Quick Launch links, grouped,
// and the search over them. src/App.palette.test.jsx opens each from the app.

const NOW = 1_782_345_600_000;
const STATUS = scenarioStatus('every-state', { now: NOW });

const PAGES = [
  { id: 'overview', label: 'Overview', href: '/' },
  { id: 'alerts', label: 'Alerts', href: '/alerts' },
];
const APPS = [{ id: 'grafana', label: 'Grafana', href: '/apps/grafana' }];
const LINKS = {
  personal: [{ name: 'Nextcloud', url: 'https://cloud.example/' }],
  devops: [
    { name: 'Grafana', url: 'https://grafana.lan' },
    { name: 'Nothing', url: 'javascript:alert(1)' },
  ],
};

function build(options = {}) {
  const entityLink = vi.fn((id) => ({
    href: `/?entity=${id}`,
    onOpen: () => entityLink.opened(id),
  }));
  entityLink.opened = vi.fn();
  const navigate = vi.fn();
  const groups = paletteIndex({
    status: STATUS,
    pages: PAGES,
    apps: APPS,
    sections: SETTINGS_SECTIONS,
    links: LINKS,
    entityLink,
    navigate,
    onLogout: vi.fn(),
    ...options,
  });
  return { groups, entityLink, navigate };
}

const group = (groups, id) => groups.find((g) => g.id === id);
const labels = (g) => g.rows.map((r) => r.label);

describe('paletteIndex', () => {
  it('lists the issues first, worst first, then the subsystems, pages, apps, Settings, Quick Launch and Log out', () => {
    const { groups } = build();
    expect(groups.map((g) => g.heading)).toEqual([
      'Issues',
      'Services',
      'Nodes',
      'Power',
      'Jobs',
      'Backups',
      'Integrations',
      'Pages',
      'Apps',
      'Settings',
      'Quick Launch',
      'Actions',
    ]);
    expect(group(groups, 'issues').rows.map((r) => r.id)).toEqual(
      STATUS.issues.map((e) => `issue:${e.id}`)
    );
    expect(
      group(groups, 'issues')
        .rows.map((r) => r.state)
        .slice(0, 2)
    ).toEqual(['crit', 'crit']);
  });

  it('an issue says where it is and why, with its lamp, and opens its entity', () => {
    const { groups, entityLink } = build();
    const edge = group(groups, 'issues').rows[0];
    expect(edge).toMatchObject({
      label: 'Network Edge',
      kind: 'Issue',
      where: 'Node · edge',
      detail: "Unreachable: Prometheus can't scrape it",
      state: 'crit',
      word: 'Unreachable',
      href: '/?entity=nodes/edge',
    });
    edge.onOpen();
    expect(entityLink.opened).toHaveBeenCalledWith('nodes/edge');
  });

  it('each entity kind: its name, kind, node and word, its lamp, and its own link', () => {
    const { groups } = build();
    const row = (id) => groups.flatMap((g) => g.rows).find((r) => r.id === `entity:${id}`);
    expect(row('services/apps:grafana')).toMatchObject({
      label: 'Grafana',
      kind: 'Service',
      where: 'apps',
      detail: 'Pending',
      state: 'warn',
      href: '/?entity=services/apps:grafana',
    });
    expect(row('services/apps:redis-cache')).toMatchObject({ kind: 'Container', where: 'apps' });
    expect(row('nodes/edge')).toMatchObject({ label: 'Network Edge', kind: 'Node', state: 'crit' });
    expect(row('power/ups')).toMatchObject({ kind: 'UPS', detail: 'On battery', where: undefined });
    expect(row('jobs/apps:db-dump')).toMatchObject({
      kind: 'Job',
      where: 'apps',
      detail: 'Failed',
    });
    expect(row('backups/storage:nightly-backup')).toMatchObject({
      kind: 'Backup',
      where: 'storage',
    });
    expect(row('integrations/jellyfin')).toMatchObject({ kind: 'Integration', detail: 'Failing' });
    expect(row('integrations/arcane:apps')).toMatchObject({
      kind: 'Arcane agent',
      detail: 'Offline',
    });
    // Every entity of the model, once, in its subsystem's group.
    const entityRows = groups.filter((g) => g.id.startsWith('entities:')).flatMap((g) => g.rows);
    expect(entityRows.map((r) => r.id)).toEqual(
      STATUS.subsystems.flatMap((s) =>
        STATUS.entities.filter((e) => e.subsystem === s.id).map((e) => `entity:${e.id}`)
      )
    );
    expect(entityRows).toHaveLength(STATUS.entities.length);
  });

  it('a stale status draws every lamp as no signal, keeping the words', () => {
    const { groups } = build({ stale: true });
    const rows = groups.flatMap((g) => g.rows).filter((r) => r.state);
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(['unknown']));
    expect(group(groups, 'issues').rows[0].word).toBe('Unreachable');
  });

  it('before the first status: no issues or entities, the rest as ever', () => {
    const { groups } = build({ status: null });
    expect(groups.map((g) => g.id)).toEqual(['pages', 'apps', 'settings', 'links', 'actions']);
  });

  it('pages, apps and Settings sections open their address in the app', () => {
    const { groups, navigate } = build();
    expect(labels(group(groups, 'pages'))).toEqual(['Overview', 'Alerts']);
    const app = group(groups, 'apps').rows[0];
    expect(app).toMatchObject({ label: 'Open Grafana', kind: 'App', href: '/apps/grafana' });
    app.onOpen();
    expect(navigate).toHaveBeenLastCalledWith('/apps/grafana');

    const settings = group(groups, 'settings').rows;
    expect(settings.map((r) => r.href)).toEqual(SETTINGS_SECTIONS.map((s) => `/settings/${s.id}`));
    const apps = settings.find((r) => r.label === 'Apps & links');
    expect(apps).toMatchObject({
      kind: 'Settings',
      detail: SETTINGS_SECTIONS.find((s) => s.id === 'apps').desc,
    });
    apps.onOpen();
    expect(navigate).toHaveBeenLastCalledWith('/settings/apps');
  });

  it('leaves out a disabled Settings section', () => {
    const { groups } = build({
      sections: [
        { id: 'general', label: 'General' },
        { id: 'tabs', label: 'Tabs', disabled: true },
      ],
    });
    expect(labels(group(groups, 'settings'))).toEqual(['General']);
  });

  it("Quick Launch links are links with the panel's target, never opened in the page", () => {
    const { groups } = build();
    const rows = group(groups, 'links').rows;
    expect(rows).toEqual([
      expect.objectContaining({
        label: 'Open Nextcloud',
        kind: 'Link',
        where: 'Personal',
        detail: 'cloud.example',
        href: 'https://cloud.example/',
        target: '_blank',
      }),
      expect.objectContaining({
        label: 'Open Grafana',
        where: 'Dev & Monitoring',
        href: 'https://grafana.lan',
      }),
    ]);
    expect(rows.every((r) => r.onOpen === undefined)).toBe(true);
    // Settings → Apps & links' "Same Tab".
    const same = build({ linkTarget: '_self' }).groups;
    expect(group(same, 'links').rows.map((r) => r.target)).toEqual(['_self', '_self']);
  });

  it('the same address in two groups is two rows', () => {
    const url = 'https://same.example/';
    const { groups } = build({
      links: { a: [{ name: 'One', url }], b: [{ name: 'Two', url }] },
    });
    const ids = group(groups, 'links').rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('has no themes; Log out only with a sign-in', () => {
    const { groups } = build();
    const all = groups.flatMap((g) => g.rows);
    // Settings → System is a section, not the theme.
    const themeLike = (r) => /^(Dark|Light|System)$/.test(r.label) && r.kind !== 'Settings';
    expect(all.some(themeLike)).toBe(false);
    expect(all.some((r) => r.id.startsWith('theme:'))).toBe(false);
    expect(group(groups, 'actions').rows[0].label).toBe('Log out');
    expect(group(build({ onLogout: null }).groups, 'actions')).toBeUndefined();
  });
});

// #317: Settings' 13 tabs became sections; each old tab's name, and what a
// section holds, finds it, by the terms sections.js gives it.
describe('paletteSearch over Settings’ sections', () => {
  const settingsFound = (query) =>
    (group(paletteSearch(build().groups, query), 'settings')?.rows ?? []).map((r) => r.href);

  it.each([
    'general',
    'appearance',
    'typography',
    'layout',
    'sections',
    'nodes',
    'services',
    'integrations',
    'links',
    'widgets',
    'tabs',
    'security',
    'backup',
  ])('the old tab’s name “%s” finds its section', (tab) => {
    expect(settingsFound(tab)).toContain(`/settings/${MOVED_SECTIONS[tab] ?? tab}`);
  });

  it('a setting inside a section finds it: "font" Appearance, "password" System', () => {
    expect(settingsFound('font')).toEqual(['/settings/appearance']);
    expect(settingsFound('clock')).toEqual(['/settings/appearance']);
    expect(settingsFound('password')).toContain('/settings/system');
  });
});

describe('paletteSearch', () => {
  it('an empty query matches everything, as it is', () => {
    const { groups } = build();
    expect(paletteSearch(groups, '')).toBe(groups);
    expect(paletteSearch(groups, '   ')).toBe(groups);
  });

  it('keeps the matching rows of each group, and drops a group with none', () => {
    const { groups } = build();
    const found = paletteSearch(groups, 'grafana');
    expect(found.map((g) => g.id)).toEqual(['issues', 'entities:services', 'apps', 'links']);
    expect(found.flatMap((g) => g.rows.map((r) => r.label))).toEqual([
      'Grafana',
      'Grafana',
      'Open Grafana',
      'Open Grafana',
    ]);
  });

  it('matches every word anywhere in a row: its kind, where, detail or group', () => {
    const { groups } = build();
    expect(paletteSearch(groups, 'open uptime')).toEqual([]);
    const backup = paletteSearch(groups, 'storage overdue');
    expect(backup.flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      'issue:backups/storage:nightly-backup',
      'entity:backups/storage:nightly-backup',
    ]);
    expect(paletteSearch(groups, 'quick launch').map((g) => g.id)).toEqual(['settings', 'links']);
    expect(paletteSearch(groups, 'ARCANE AGENT')[0].rows[0].id).toBe(
      'issue:integrations/arcane:apps'
    );
  });

  it('orders the groups by their best row, ties in their own order, the issues first', () => {
    const { groups } = build();
    // Grafana starts with "gr"; "Open Grafana" has a word that does, which
    // counts alike; Settings' Integrations only holds it (a name may, anywhere).
    // The Integrations heading holds it too, but not at a word's start: no match.
    expect(paletteSearch(groups, 'gr').map((g) => g.id)).toEqual([
      'issues',
      'entities:services',
      'apps',
      'links',
      'settings',
    ]);
    expect(paletteSearch(groups, 'gra')[0].rows[0].label).toBe('Grafana');
  });

  it('a word of a name starting with the query counts as the name does: the failing backup over Settings › System (backup and restore)', () => {
    const { groups } = build();
    const found = paletteSearch(groups, 'backup');
    expect(found.map((g) => g.id)).toEqual(['issues', 'entities:backups', 'settings']);
    expect(found[0].rows[0].id).toBe('issue:backups/storage:nightly-backup');
    expect(found[2].rows[0].label).toBe('System');
  });

  it('matches a heading or a detail only at a word’s start, a name anywhere', () => {
    const { groups } = build();
    // Not "Backups" (the heading) or "custom groups" (Nodes & Services' detail);
    // Settings' Sources by its NUT (UPS) (#318), Notifications' UPS category (#320).
    const ups = paletteSearch(groups, 'ups');
    expect(ups.flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      'issue:power/ups',
      'entity:power/ups',
      'settings:sources',
      'settings:notifications',
    ]);
    // "Example UPS 1500VA": inside the name, as a name may be.
    expect(paletteSearch(groups, '1500').flatMap((g) => g.rows.map((r) => r.id))).toEqual([
      'issue:power/ups',
      'entity:power/ups',
    ]);
    // A detail still matches at a word's start: "(retrying its check)", Kuma's reason.
    expect(paletteSearch(groups, 'retrying')[0].rows[0].id).toBe('issue:services/apps:grafana');
    expect(paletteSearch(groups, 'etrying')).toEqual([]);
  });

  it('ranks a name that starts with the query first, then a word of it, then any match', () => {
    const groups = [
      {
        id: 'g',
        heading: 'G',
        rows: [
          { id: '1', label: 'Back office', detail: 'net' },
          { id: '2', label: 'Ethernet bridge' },
          { id: '3', label: 'Net gateway' },
          { id: '4', label: 'Home net' },
        ],
      },
    ];
    expect(paletteSearch(groups, 'net')[0].rows.map((r) => r.id)).toEqual(['3', '4', '2', '1']);
  });
});
