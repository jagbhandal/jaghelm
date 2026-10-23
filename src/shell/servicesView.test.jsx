/*
 * The Services section's rows and groups (#300), from the model and the
 * board's readings: every state, word and reason is read from /api/status as
 * the server's own model builds it (the demo's boards, the cross-client
 * scenarios), never written here by hand.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  GROUPING_PREF,
  SERVICES_VIEW_PREF,
  filterServiceRows,
  groupingsFor,
  headlineMetric,
  serviceFilterOptions,
  serviceGroups,
  serviceRows,
  servicesCount,
  useServicesGrouping,
  useServicesView,
} from './servicesView.js';
import { entityAnchor } from './entityAnchors.js';
import { demoBoard, nasDiskIncident, twoPis } from '../testing/statusFixtures.js';
import { runScenario } from '../../server/testing/statusScenarios.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');

/** A scenario as a client gets it: the status, and the /api/services it was built from. */
function scenario(name) {
  const { status, cycle } = runScenario(name, { now: NOW });
  return JSON.parse(JSON.stringify({ status, services: cycle.caches.getCached('services') }));
}

const serviceEntities = (status) => status.entities.filter((e) => e.subsystem === 'services');
const cardOf = (services, uid) =>
  Object.values(services.nodes)
    .flatMap((n) => n.services)
    .find((c) => c.uid === uid);
const STALE = { stale: true, note: 'No signal · last known 3 min ago' };

describe('the Services rows, from the model', () => {
  it("healthy: a row per service entity, each the model's state and word, its latency from /api/services", () => {
    const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
    const rows = serviceRows({ status, services });
    expect(rows.map((r) => r.id)).toEqual(serviceEntities(status).map((e) => e.id));
    for (const r of rows) {
      const e = status.entities.find((x) => x.id === r.id);
      const card = cardOf(services, r.uid);
      expect(r).toMatchObject({
        anchor: entityAnchor(e.id),
        name: e.name,
        node: e.node,
        nodeName: services.nodes[e.node].display_name,
        level: e.state,
        state: e.state,
        word: e.word,
        muted: true,
      });
      expect(r.state).toBe('ok');
      // The demo's monitors answer in a few ms; its unmonitored containers have none.
      expect(r.meta).toBe(card?.ping ? `${Math.round(card.ping)} ms` : '—');
      // No integration on the demo: nothing to say beside an up service.
      expect(r.detail).toBeNull();
    }
    expect(rows.some((r) => r.meta !== '—')).toBe(true);
    expect(servicesCount(rows)).toBe(`${rows.length} monitored · all up`);
  });

  it("incident: the down service says the model's reason, no latency, and isn't muted", () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const rows = serviceRows({ status, services });
    const down = rows.filter((r) => r.level !== 'ok');
    expect(down.map((r) => r.name)).toEqual(['Jellyfin']);
    const e = status.entities.find((x) => x.id === down[0].id);
    expect(down[0]).toMatchObject({
      state: 'crit',
      word: e.word,
      detail: e.reason,
      meta: '—',
      muted: false,
    });
    // The card still holds Kuma's last ping, 0 for a down monitor: never drawn.
    expect(servicesCount(rows)).toBe(`${rows.length} monitored · 1 down`);
  });

  it('every state: pending, missing, maintenance and a monitor with no card, each as the model says it', () => {
    const { status, services } = scenario('every-state');
    const rows = serviceRows({ status, services });
    expect(rows.map((r) => r.id)).toEqual(serviceEntities(status).map((e) => e.id));
    const notUp = rows.filter((r) => r.level !== 'ok');
    expect(notUp.length).toBeGreaterThanOrEqual(3);
    for (const r of notUp) {
      const e = status.entities.find((x) => x.id === r.id);
      expect(r, r.id).toMatchObject({ state: e.state, word: e.word, detail: e.reason, meta: '—' });
      expect(r.muted).toBe(false);
    }
    // The count names each kind by the model's word, worst first.
    const count = servicesCount(rows);
    expect(count).toMatch(new RegExp(`^${rows.length} monitored · `));
    for (const r of notUp) {
      const said = r.level === 'maintenance' ? 'in maintenance' : String(r.word).toLowerCase();
      expect(count, r.word).toContain(said);
    }
    expect(count).not.toContain('all up');
  });

  // #480, #495: a stale status draws no level.
  it('stale: every row no signal, its words and numbers kept as last known, in the same order', () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const fresh = serviceRows({ status, services });
    const stale = serviceRows({ status, services, freshness: STALE });
    expect(stale.map((r) => r.id)).toEqual(fresh.map((r) => r.id));
    for (const [i, r] of stale.entries()) {
      expect(r.state, r.name).toBe('unknown');
      expect(r).toMatchObject({
        level: fresh[i].level,
        word: fresh[i].word,
        detail: fresh[i].detail,
        meta: fresh[i].meta,
      });
    }
    expect(servicesCount(stale, STALE)).toBe(
      `${stale.length} monitored · No signal · last known 3 min ago`
    );
    // Grouped as they were, worst first by what the model last said.
    const groups = (rows) => serviceGroups(rows, { services }).map((g) => g.rows.map((r) => r.id));
    expect(groups(stale)).toEqual(groups(fresh));
  });

  it('leaves out the services of a node hidden in Settings, as the node is', () => {
    const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
    const rows = serviceRows({ status, services, sections: { edge: { visible: false } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.node === 'edge')).toBe(false);
  });

  it('an integration on a service: its headline metric, only while the model says it is up', () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const appData = {
      'apps:nextcloud': { Files: '18,204', Users: '6' },
      'apps:jellyfin': { Version: '10.9.1' },
    };
    const rows = serviceRows({ status, services, appData });
    const by = (name) => rows.find((r) => r.name === name);
    expect(by('Nextcloud').detail).toBe('18,204 files');
    expect(by('Jellyfin').detail).toBe(
      status.entities.find((e) => e.id === by('Jellyfin').id).reason
    );
  });
});

// #300 review: a container of one name on two nodes (AdGuard on both
// gateways) is two services, each with its own numbers.
it("the metric is the service's own, by uid: a same-named container on another node shows its own, or none", () => {
  const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
  const copy = (node) => node.services.find((c) => c.container === 'adguard-home');
  const twin = { ...copy(services.nodes.edge), uid: 'storage:adguard-home' };
  const both = {
    ...services,
    nodes: {
      ...services.nodes,
      storage: { ...services.nodes.storage, services: [...services.nodes.storage.services, twin] },
    },
  };
  const entity = status.entities.find((e) => e.id === 'services/edge:adguard-home');
  const withTwin = {
    ...status,
    entities: [
      ...status.entities,
      { ...entity, id: 'services/storage:adguard-home', node: 'storage' },
    ],
  };
  const row = (rows, id) => rows.find((r) => r.id === id);
  const one = serviceRows({
    status: withTwin,
    services: both,
    appData: { 'edge:adguard-home': { Queries: '41k' } },
  });
  expect(row(one, 'services/edge:adguard-home').detail).toBe('41k queries');
  expect(row(one, 'services/storage:adguard-home').detail).toBeNull();
  const two = serviceRows({
    status: withTwin,
    services: both,
    appData: {
      'edge:adguard-home': { Queries: '41k' },
      'storage:adguard-home': { Queries: '12k' },
    },
  });
  expect(row(two, 'services/storage:adguard-home').detail).toBe('12k queries');
});

describe('headlineMetric', () => {
  it('is the first field, an amount before its label, anything else after', () => {
    expect(headlineMetric({ Photos: '24,499', Videos: '1,203' })).toBe('24,499 photos');
    expect(headlineMetric({ Queries: '41k' })).toBe('41k queries');
    expect(headlineMetric({ Version: '10.9.1' })).toBe('Version 10.9.1');
    expect(headlineMetric({ Usage: '1.2 TB' })).toBe('Usage 1.2 TB');
  });

  it('skips the internal fields and empty values; none without a field', () => {
    expect(headlineMetric({ _doctor: { error: 'x' }, Streams: '', Users: '3' })).toBe('3 users');
    expect(headlineMetric({ _doctor: { error: 'HTTP 401' } })).toBeNull();
    expect(headlineMetric(null)).toBeNull();
    expect(headlineMetric({})).toBeNull();
  });
});

describe('the Services groups', () => {
  it("by node: services.yaml's order, the worst first, then by name; the count up of all", () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const groups = serviceGroups(serviceRows({ status, services }), { by: 'node', services });
    expect(groups.map((g) => g.key)).toEqual(Object.keys(services.nodes).map((k) => `node:${k}`));
    for (const g of groups) {
      const key = g.key.slice('node:'.length);
      expect(g.title).toBe(services.nodes[key].display_name);
      expect(g.host).toBe(key);
      const ranked = [...g.rows].sort(
        (a, b) => (a.level === 'ok') - (b.level === 'ok') || a.name.localeCompare(b.name)
      );
      expect(g.rows.map((r) => r.name)).toEqual(ranked.map((r) => r.name));
      const up = g.rows.filter((r) => r.level === 'ok').length;
      expect(g.count).toBe(`${up} / ${g.rows.length} up`);
      // The group names the node: its rows don't repeat it.
      expect(g.rows.every((r) => r.where === null)).toBe(true);
    }
    const apps = groups.find((g) => g.key === 'node:apps');
    expect(apps.rows[0].name).toBe('Jellyfin');
  });

  it('by node: a node /api/services has yet to list comes after the listed ones, its key the title', () => {
    const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
    const rows = serviceRows({ status, services });
    const { edge: _edge, ...rest } = services.nodes;
    const groups = serviceGroups(
      rows.map((r) => (r.node === 'edge' ? { ...r, nodeName: null } : r)),
      { services: { ...services, nodes: rest } }
    );
    expect(groups.at(-1)).toMatchObject({ key: 'node:edge', title: 'edge', host: null });
  });

  it('by group: each custom group in order, by uid or container name, then the rest; the node beside each name', () => {
    const { status, services } = demoBoard({ scenario: 'incident', now: NOW });
    const rows = serviceRows({ status, services });
    const customGroups = [
      { id: 'media', title: 'Media', containers: ['apps:jellyfin', 'photoprism'] },
      { id: 'empty', title: 'Nothing here', containers: ['gone:nowhere'] },
      // A service in two groups is in the first.
      { id: 'again', title: 'Again', containers: ['jellyfin', 'apps:gitea'] },
    ];
    const groups = serviceGroups(rows, { by: 'group', services, customGroups });
    expect(groups.map((g) => g.title)).toEqual(['Media', 'Again', 'Not in a group']);
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Jellyfin', 'Photoprism']);
    expect(groups[0].count).toBe('1 / 2 up');
    expect(groups[1].rows.map((r) => r.name)).toEqual(['Gitea']);
    expect(groups[2].rows).toHaveLength(rows.length - 3);
    for (const g of groups) {
      expect(g.host).toBeNull();
      for (const r of g.rows) expect(r.where, r.name).toBe(r.nodeName);
    }
  });

  // #517: the same container on two nodes is two services, and a Kuma monitor
  // with no container is one too.
  it("by group: a uid takes that node's service, never its namesake on the other node; a Kuma-only monitor is grouped", () => {
    const { status, services } = twoPis();
    const rows = serviceRows({ status, services });
    const customGroups = [
      { id: 'dns', title: 'DNS', containers: ['pi-1:adguard-home'] },
      { id: 'home', title: 'Home', containers: ['pi-1:Home Assistant'] },
    ];
    const groups = serviceGroups(rows, { by: 'group', services, customGroups });
    const placed = (title) => groups.find((g) => g.title === title).rows.map((r) => r.uid);
    expect(groups.map((g) => g.title)).toEqual(['DNS', 'Home', 'Not in a group']);
    expect(placed('DNS')).toEqual(['pi-1:adguard-home']);
    expect(placed('Home')).toEqual(['pi-1:Home Assistant']);
    expect(placed('Not in a group')).toEqual(['pi-2:adguard-home', 'pi-2:unbound']);
    expect(groups[0].rows[0].where).toBe('Pi 1');
  });

  it('by group: a bare name saved before #517 still takes every service of that name', () => {
    const { status, services } = twoPis();
    const rows = serviceRows({ status, services });
    const customGroups = [
      { id: 'dns', title: 'DNS', icon: '📂', borderColor: '#fff', containers: ['adguard-home'] },
    ];
    const groups = serviceGroups(rows, { by: 'group', services, customGroups });
    expect(groups[0].rows.map((r) => r.uid)).toEqual(['pi-1:adguard-home', 'pi-2:adguard-home']);
  });

  it('by group with no custom group: by node', () => {
    const { status, services } = demoBoard({ scenario: 'healthy', now: NOW });
    const rows = serviceRows({ status, services });
    expect(serviceGroups(rows, { by: 'group', services, customGroups: [] })).toEqual(
      serviceGroups(rows, { by: 'node', services })
    );
  });

  it('offers Node and Group always, Group disabled without a custom group; never by tag', () => {
    for (const none of [[], undefined]) {
      expect(groupingsFor(none)).toEqual([
        { value: 'node', label: 'Node', disabled: false },
        { value: 'group', label: 'Group', disabled: true },
      ]);
    }
    expect(groupingsFor([{ id: 'a', containers: [] }])).toEqual([
      { value: 'node', label: 'Node', disabled: false },
      { value: 'group', label: 'Group', disabled: false },
    ]);
  });
});

describe('useServicesGrouping: the choice kept in this browser', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('by node by default; a choice is stored, and read back', () => {
    const { result } = renderHook(() => useServicesGrouping());
    expect(result.current[0]).toBe('node');
    act(() => result.current[1]('group'));
    expect(result.current[0]).toBe('group');
    expect(localStorage.getItem(GROUPING_PREF)).toBe('group');
    const again = renderHook(() => useServicesGrouping());
    expect(again.result.current[0]).toBe('group');
  });

  it('ignores a value it does not know, stored or asked for', () => {
    localStorage.setItem(GROUPING_PREF, 'tag');
    const { result } = renderHook(() => useServicesGrouping());
    expect(result.current[0]).toBe('node');
    act(() => result.current[1]('tag'));
    expect(result.current[0]).toBe('node');
    expect(localStorage.getItem(GROUPING_PREF)).toBe('tag');
  });

  it('with storage blocked: by node, and a choice lasts the visit', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useServicesGrouping());
    expect(result.current[0]).toBe('node');
    act(() => result.current[1]('group'));
    expect(result.current[0]).toBe('group');
  });
});

// The Services page's filters (#313): what each keeps, read from the model.
describe('filterServiceRows: the Services page filters the same rows', () => {
  const board = () => nasDiskIncident();
  const rowsOf = (status, services) => serviceRows({ status, services });
  const names = (rows) => rows.map((r) => r.name).sort();

  it('none: every row, in its order', () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    expect(filterServiceRows(rows, {})).toEqual(rows);
    expect(filterServiceRows(rows, { q: '', state: null, node: null, tag: null })).toEqual(rows);
  });

  it("search: a service's name, its node's key or name, its container, its custom group", () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    expect(names(filterServiceRows(rows, { q: 'JELLY' }))).toEqual(['Jellyfin']);
    // The node's key, and its name: every service on it.
    const onEdge = rows
      .filter((r) => r.node === 'edge')
      .map((r) => r.name)
      .sort();
    expect(names(filterServiceRows(rows, { q: 'edge' }))).toEqual(onEdge);
    expect(names(filterServiceRows(rows, { q: 'network edge' }))).toEqual(onEdge);
    // The container, as /api/services names it.
    const card = rows.find((r) => r.name === 'Paperless Ngx');
    expect(names(filterServiceRows(rows, { q: card.container }))).toContain('Paperless Ngx');
    // A custom group holding it, by uid.
    const media = [{ id: 'media', title: 'Media shelf', containers: ['apps:jellyfin'] }];
    expect(names(filterServiceRows(rows, { q: 'shelf' }, { customGroups: media }))).toEqual([
      'Jellyfin',
    ]);
    // Every word somewhere: the name and the node.
    expect(names(filterServiceRows(rows, { q: 'jelly server' }))).toEqual(['Jellyfin']);
    expect(filterServiceRows(rows, { q: 'jelly storage' })).toEqual([]);
  });

  it("state: as drawn; problems are the model's issues", () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    expect(names(filterServiceRows(rows, { state: 'problems' }))).toEqual(['Jellyfin']);
    expect(filterServiceRows(rows, { state: 'ok' })).toHaveLength(rows.length - 1);
    expect(filterServiceRows(rows, { state: 'maintenance' })).toEqual([]);
    expect(filterServiceRows(rows, { state: 'no-signal' })).toEqual([]);
    // A stale status draws every row as no signal: each is listed as drawn.
    const stale = serviceRows({ status, services, freshness: { stale: true } });
    expect(filterServiceRows(stale, { state: 'no-signal' })).toHaveLength(rows.length);
    expect(filterServiceRows(stale, { state: 'problems' })).toHaveLength(rows.length);
    expect(filterServiceRows(stale, { state: 'ok' })).toEqual([]);
  });

  it("state: maintenance and no signal, from the model's own scenarios", () => {
    for (const [name, filter, level] of [
      ['every-state', 'maintenance', 'maintenance'],
      ['source-down', 'no-signal', 'unknown'],
    ]) {
      const { status, services } = scenario(name);
      const rows = rowsOf(status, services);
      const want = rows.filter((r) => r.level === level).map((r) => r.id);
      expect(want.length, filter).toBeGreaterThan(0);
      expect(filterServiceRows(rows, { state: filter }).map((r) => r.id)).toEqual(want);
    }
    // Maintenance is no problem (the model's issues leave it out); pending is.
    const { status, services } = scenario('every-state');
    const problems = filterServiceRows(rowsOf(status, services), { state: 'problems' });
    expect(problems.map((r) => r.level).sort()).toEqual(['warn', 'warn']);
  });

  it("node: its key's services only; with the search, both", () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    const apps = filterServiceRows(rows, { node: 'apps' });
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every((r) => r.node === 'apps')).toBe(true);
    expect(names(filterServiceRows(rows, { node: 'apps', q: 'graf' }))).toEqual(['Grafana']);
    expect(filterServiceRows(rows, { node: 'edge', q: 'graf' })).toEqual([]);
    expect(filterServiceRows(rows, { node: 'nowhere' })).toEqual([]);
  });

  it('tag: no service has tags yet (#519), so no Tag filter is offered; once one does, it filters', () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    expect(rows.every((r) => r.tags.length === 0)).toBe(true);
    expect(serviceFilterOptions(rows, services).tags).toEqual([]);
    // Tags served on the entities, as #519 will.
    const tagged = {
      ...status,
      entities: status.entities.map((e) =>
        e.id === 'services/apps:jellyfin'
          ? { ...e, tags: ['media', ' media ', 'public', 3] }
          : e.id === 'services/storage:photoprism'
            ? { ...e, tags: ['media'] }
            : e
      ),
    };
    const withTags = rowsOf(tagged, services);
    expect(withTags.find((r) => r.name === 'Jellyfin').tags).toEqual(['media', 'public']);
    expect(serviceFilterOptions(withTags, services).tags).toEqual(['media', 'public']);
    expect(names(filterServiceRows(withTags, { tag: 'media' }))).toEqual([
      'Jellyfin',
      'Photoprism',
    ]);
    expect(names(filterServiceRows(withTags, { tag: 'public' }))).toEqual(['Jellyfin']);
    expect(names(filterServiceRows(withTags, { q: 'public' }))).toEqual(['Jellyfin']);
  });

  it("the Node filter's options: services.yaml's order, by name", () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    expect(serviceFilterOptions(rows, services).nodes).toEqual(
      Object.entries(services.nodes).map(([value, n]) => ({ value, label: n.display_name }))
    );
    // Before /api/services answers: the model's nodes, by their keys.
    expect(serviceFilterOptions(rowsOf(status, null), null).nodes.map((n) => n.label)).toEqual([
      ...new Set(rows.map((r) => r.node)),
    ]);
  });

  it('the count says what a filter left of how many', () => {
    const { status, services } = board();
    const rows = rowsOf(status, services);
    const shown = filterServiceRows(rows, { node: 'apps' });
    expect(servicesCount(shown, null, { of: rows.length })).toBe(
      `${shown.length} of ${rows.length} monitored · 1 down`
    );
    expect(servicesCount([], null, { of: rows.length })).toBe(`0 of ${rows.length} monitored`);
  });
});

describe('useServicesView: list or table, kept in this browser', () => {
  afterEach(() => localStorage.clear());

  it('a list by default; a table is stored, and read back', () => {
    const { result } = renderHook(() => useServicesView());
    expect(result.current[0]).toBe('list');
    act(() => result.current[1]('table'));
    expect(localStorage.getItem(SERVICES_VIEW_PREF)).toBe('table');
    expect(renderHook(() => useServicesView()).result.current[0]).toBe('table');
    act(() => result.current[1]('cards'));
    expect(result.current[0]).toBe('table');
  });

  it("the grouping is one choice for the Overview and the page: a change in one is the other's", () => {
    const overview = renderHook(() => useServicesGrouping());
    const page = renderHook(() => useServicesGrouping());
    act(() => page.result.current[1]('group'));
    expect(overview.result.current[0]).toBe('group');
  });
});
