/*
 * Compose stacks in the Services rows and groups (#642): the rows come from
 * the server's own model (server/testing/stackBoard.js, the real
 * assembleServices and status model over Jag's vm-103), never written here by
 * hand. A stack is one row; its folded containers are in the data, not the
 * list; counts are rows; a custom group that holds a uid shows that uid.
 */
import { describe, it, expect } from 'vitest';
import { serviceGroups, serviceRows, servicesCount, upCount } from './servicesView.js';
import { withPinned } from './overviewLayout.js';
import { issueRows, stackIssue } from './statusView.js';
import { webStatus } from '../hooks/useStatus.js';
import { stackBoard } from '../../server/testing/stackBoard.js';

// The board as the web reads it: counted by stacks (useStatus webStatus).
const webBoard = (opts) => {
  const board = stackBoard(opts);
  return { ...board, status: webStatus(board.status) };
};

const rowsOf = (opts) => {
  const { status, services } = webBoard(opts);
  return { status, services, rows: serviceRows({ status, services }) };
};
const names = (rows) => rows.map((r) => r.name).sort();

describe('a stack is one row', () => {
  it('lists Immich, Nextcloud, Wiki.js and Loki once each, Collabora and the singles beside them', () => {
    const { rows, status } = rowsOf();
    expect(names(rows)).toEqual(['Collabora', 'Gitea', 'Grafana', 'Immich', 'Loki', 'Nextcloud', 'Wiki.js']);
    // The data keeps every container: 16 service entities, 9 of them folded.
    expect(status.entities.filter((e) => e.subsystem === 'services')).toHaveLength(16);
    expect(rows).toHaveLength(7);
    expect(status.subsystems.find((s) => s.id === 'services').counts.total).toBe(7);
  });

  it("a stack row says its chip and carries its folded containers' rows", () => {
    const { rows } = rowsOf();
    const immich = rows.find((r) => r.name === 'Immich');
    expect(immich.stack).toMatchObject({ count: 4, chip: '+3', bad: false });
    expect(immich.folded.map((r) => r.uid).sort()).toEqual([
      'vm103:immich-machine-learning',
      'vm103:immich-postgres',
      'vm103:immich-redis',
    ]);
    // Its uid is the lead's: opening the row opens the lead's entity.
    expect(immich.id).toBe('services/vm103:immich-server');
    expect(rows.find((r) => r.name === 'Gitea').stack).toBeUndefined();
  });

  it('a failing container turns the row to the rollup: its word, its reason, its colour, the chip', () => {
    const { rows } = rowsOf({ redis: 'down' });
    const immich = rows.find((r) => r.name === 'Immich');
    expect(immich).toMatchObject({
      state: 'crit',
      level: 'crit',
      word: 'Degraded',
      detail: 'Immich Redis is down',
      muted: false,
      meta: '—',
    });
    expect(immich.stack).toMatchObject({ chip: '+3 · 1 down', bad: true, count: 4 });
    // Nothing else changes: the other stacks are still up.
    expect(rows.filter((r) => r.level !== 'ok').map((r) => r.name)).toEqual(['Immich']);
    expect(servicesCount(rows)).toBe('7 monitored · 1 degraded');
  });

  it('a stopped container is a warning on the row, in its own words', () => {
    const { rows } = rowsOf({ redis: 'stopped' });
    const immich = rows.find((r) => r.name === 'Immich');
    expect(immich).toMatchObject({ state: 'warn', word: 'Degraded', detail: 'Immich Redis has stopped' });
    expect(immich.stack.chip).toBe('+3 · 1 stopped');
  });

  it('a stale status draws the stack row as no signal, its words kept', () => {
    const { status, services } = webBoard({ redis: 'down' });
    const rows = serviceRows({ status, services, freshness: { stale: true } });
    const immich = rows.find((r) => r.name === 'Immich');
    expect(immich).toMatchObject({ state: 'unknown', level: 'crit', word: 'Degraded' });
  });

  it('a node hidden in Settings leaves its stacks out, folded containers too', () => {
    const { status, services } = webBoard();
    expect(serviceRows({ status, services, sections: { vm103: { visible: false } } })).toEqual([]);
  });
});

describe('the groups', () => {
  const { status, services, rows } = rowsOf({ redis: 'down' });

  it('by node: the stack rows only, worst first', () => {
    const [group] = serviceGroups(rows, { by: 'node', services });
    expect(group.rows.map((r) => r.name)[0]).toBe('Immich');
    expect(group.rows).toHaveLength(7);
    expect(group.count).toBe('6 / 7 up');
  });

  it('a custom group that holds the lead shows the stack row', () => {
    const groups = serviceGroups(rows, {
      by: 'group',
      services,
      customGroups: [{ id: 'photos', title: 'Photos', containers: ['vm103:immich-server'] }],
    });
    const photos = groups.find((g) => g.key === 'group:photos');
    expect(photos.rows.map((r) => r.name)).toEqual(['Immich']);
    expect(photos.rows[0].stack.count).toBe(4);
    // The folded containers are in no "Not in a group" row.
    const rest = groups.find((g) => g.key === 'group:none');
    expect(rest.rows.map((r) => r.uid)).not.toContain('vm103:immich-redis');
  });

  it('a custom group that holds a folded container by its uid shows it as itself, with its own state', () => {
    const groups = serviceGroups(rows, {
      by: 'group',
      services,
      customGroups: [{ id: 'cache', title: 'Caches', containers: ['vm103:immich-redis'] }],
    });
    const caches = groups.find((g) => g.key === 'group:cache');
    expect(caches.rows).toHaveLength(1);
    expect(caches.rows[0]).toMatchObject({ uid: 'vm103:immich-redis', state: 'crit', word: 'Down' });
    expect(caches.rows[0].stack).toBeUndefined();
    // The stack's own row is still in its place.
    expect(groups.find((g) => g.key === 'group:none').rows.map((r) => r.name)).toContain('Immich');
    expect(status.entities.find((e) => e.id === 'services/vm103:immich-redis').foldedInto).toBe(
      'services/vm103:immich-server'
    );
  });

  it('a folded container no group holds is in no list', () => {
    const groups = serviceGroups(rows, { by: 'group', services, customGroups: [{ id: 'x', title: 'X', containers: ['vm103:gitea'] }] });
    const all = groups.flatMap((g) => g.rows.map((r) => r.uid));
    expect(all).not.toContain('vm103:immich-postgres');
    expect(all).toHaveLength(7);
  });
});

describe('Attention names the failing container', () => {
  it('the issue is the stack row, worded with the member and how many', () => {
    const { status } = webBoard({ redis: 'down' });
    expect(status.issues).toHaveLength(1);
    const [row] = issueRows(status, Date.parse('2026-10-24T14:14:00Z'));
    expect(row).toMatchObject({
      title: 'Immich',
      where: 'Stack · vm103',
      word: 'Degraded',
      state: 'crit',
      reason: 'Immich Redis is down · 1 of 4 containers',
      age: '6 m',
    });
    expect(stackIssue(status.entities[0])).toEqual({});
  });
});

// #330: Edit layout pins a stack by its lead's uid, and it stays the one row.
describe('a pinned stack (#330)', () => {
  it('is one row in the Pinned group, with its chip and folded containers, and no row beside it', () => {
    const { rows, services } = rowsOf();
    const groups = withPinned(
      serviceGroups(rows, { services }),
      ['vm103:immich-server', 'vm103:gitea'],
      upCount
    );
    expect(groups[0].key).toBe('pinned');
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Immich', 'Gitea']);
    const immich = groups[0].rows[0];
    expect(immich.stack).toMatchObject({ count: 4, chip: '+3' });
    expect(immich.folded).toHaveLength(3);
    const all = groups.flatMap((g) => g.rows);
    expect(all.filter((r) => r.name === 'Immich')).toHaveLength(1);
    expect(all).toHaveLength(rows.length);
  });

  it('a folded container’s uid pins nothing: it has no row of its own', () => {
    const { rows, services } = rowsOf();
    const groups = serviceGroups(rows, { services });
    expect(withPinned(groups, ['vm103:immich-redis'], upCount)).toBe(groups);
  });
});
