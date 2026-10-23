/*
 * What the Services and Infrastructure pages' filters keep (#313,
 * pageFilters.js), read from the model as the server's own builds it (the
 * cross-client fixtures and scenarios), never written here by hand.
 */
import { describe, it, expect } from 'vitest';
import {
  filterNodes,
  filterServiceRows,
  roleOptions,
  serviceFilterOptions,
} from './pageFilters.js';
import { infrastructureCount, infrastructureNodes } from './infrastructureView.js';
import { serviceRows, servicesCount } from './servicesView.js';
import { nasDiskIncident } from '../testing/statusFixtures.js';
import { runScenario } from '../../server/testing/statusScenarios.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');

/** A scenario as a client gets it: the status, and the /api/services it was built from. */
function scenario(name) {
  const { status, cycle } = runScenario(name, { now: NOW });
  return JSON.parse(JSON.stringify({ status, services: cycle.caches.getCached('services') }));
}

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

// The Infrastructure page's filters (#313): what each keeps, read from the model.
describe('filterNodes: the Infrastructure page filters the same nodes', () => {
  const nodesOf = (opts) => {
    const { status, services } = nasDiskIncident();
    return infrastructureNodes({ status, services, ...opts });
  };
  const names = (nodes) => nodes.map((n) => n.name);

  it('none: every node, in its order', () => {
    const nodes = nodesOf();
    expect(filterNodes(nodes, {})).toEqual(nodes);
    expect(filterNodes(nodes, { q: '', state: null, role: null })).toEqual(nodes);
  });

  it("search: a node's name, its key, its role", () => {
    const nodes = nodesOf();
    expect(names(filterNodes(nodes, { q: 'network' }))).toEqual(['Network Edge']);
    expect(names(filterNodes(nodes, { q: 'STORAGE' }))).toEqual(['Storage']);
    expect(names(filterNodes(nodes, { q: 'apps' }))).toEqual(['App Server']);
    expect(names(filterNodes(nodes, { q: 'proxmox' }))).toEqual(['App Server']);
    expect(names(filterNodes(nodes, { q: 'raspberry edge' }))).toEqual(['Network Edge']);
    expect(filterNodes(nodes, { q: 'raspberry nas' })).toEqual([]);
  });

  it("state: as drawn; problems are the model's issues", () => {
    const nodes = nodesOf();
    expect(names(filterNodes(nodes, { state: 'problems' }))).toEqual(['Storage']);
    expect(names(filterNodes(nodes, { state: 'ok' }))).toEqual(['Network Edge', 'App Server']);
    expect(filterNodes(nodes, { state: 'no-signal' })).toEqual([]);
    // Stale: every node is drawn as no signal, and listed so.
    const stale = nodesOf({ freshness: { stale: true } });
    expect(filterNodes(stale, { state: 'no-signal' })).toHaveLength(3);
    expect(filterNodes(stale, { state: 'ok' })).toEqual([]);
  });

  it("role: services.yaml's subtitle; the Role filter's options, each once", () => {
    const nodes = nodesOf();
    expect(names(filterNodes(nodes, { role: 'NAS' }))).toEqual(['Storage']);
    expect(filterNodes(nodes, { role: 'Mainframe' })).toEqual([]);
    expect(roleOptions(nodes)).toEqual(
      nodes.map((n) => ({ value: n.subtitle, label: n.subtitle }))
    );
    expect(
      roleOptions([...nodes, { ...nodes[0], id: 'x' }, { ...nodes[0], subtitle: null }])
    ).toHaveLength(3);
  });

  it('the count says what a filter left of how many', () => {
    const nodes = nodesOf();
    const shown = filterNodes(nodes, { state: 'problems' });
    expect(infrastructureCount(shown, null, { of: 3 })).toBe('1 of 3 nodes · 1 warning');
    expect(infrastructureCount([], null, { of: 1 })).toBe('0 of 1 node');
    expect(infrastructureCount(nodes)).toBe('3 nodes · 1 warning');
  });
});
