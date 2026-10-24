import { describe, expect, it } from 'vitest';
import {
  REORDERABLE,
  assignGroup,
  groupOf,
  isDefaultLayout,
  layoutValue,
  moveBy,
  moveTo,
  pin,
  placeOf,
  pruneLayout,
  readLayout,
  serviceGone,
  unpin,
  withPinned,
} from './overviewLayout.js';

// #330: the Overview's arrangement, as ordered ids and uids.
describe('readLayout: the arrangement a config holds', () => {
  it('reads no arrangement as the default order and nothing pinned', () => {
    for (const config of [undefined, null, {}, { overviewLayout: undefined }]) {
      expect(readLayout(config)).toEqual({ order: [...REORDERABLE], pinned: [] });
    }
    expect(REORDERABLE).toEqual(['infrastructure', 'power', 'jobs', 'services']);
  });

  it('reads a stored order, with a section it lacks after the stored ones in the default order', () => {
    const config = { overviewLayout: { order: ['services', 'power'], pinned: ['pi-1:a'] } };
    expect(readLayout(config)).toEqual({
      order: ['services', 'power', 'infrastructure', 'jobs'],
      pinned: ['pi-1:a'],
    });
  });

  it('ignores an id no section has, a duplicate, and what is not a string', () => {
    const config = {
      overviewLayout: {
        order: ['jobs', 'nope', 'jobs', 7, null, 'attention', 'strip', 'rail'],
        pinned: ['x:y', 'x:y', '', 4, {}],
      },
    };
    expect(readLayout(config)).toEqual({
      order: ['jobs', 'infrastructure', 'power', 'services'],
      pinned: ['x:y'],
    });
  });

  it('reads a value of the wrong shape as unset, never throws', () => {
    for (const bad of ['services', 5, true, [], [['jobs']], { order: 'jobs', pinned: 'a' }]) {
      expect(readLayout({ overviewLayout: bad })).toEqual({
        order: [...REORDERABLE],
        pinned: [],
      });
    }
  });

  it('does not read the old grid board’s keys', () => {
    const config = { gridLayout: [{ i: 'services', x: 0, y: 0 }], gridColumns: 4 };
    expect(readLayout(config)).toEqual({ order: [...REORDERABLE], pinned: [] });
  });
});

describe('layoutValue: what to save', () => {
  it('is nothing for the default, so an untouched config stays as it was', () => {
    expect(layoutValue(readLayout({}))).toBeUndefined();
    expect(isDefaultLayout(readLayout({}))).toBe(true);
  });

  it('keeps only what differs: the order, the pins', () => {
    const order = ['services', 'infrastructure', 'power', 'jobs'];
    expect(layoutValue({ order, pinned: [] })).toEqual({ order });
    expect(layoutValue({ order: [...REORDERABLE], pinned: ['a:b'] })).toEqual({ pinned: ['a:b'] });
    expect(layoutValue({ order, pinned: ['a:b'] })).toEqual({ order, pinned: ['a:b'] });
  });

  it('round-trips through readLayout', () => {
    const layout = {
      order: ['jobs', 'services', 'power', 'infrastructure'],
      pinned: ['a:b', 'c:d'],
    };
    expect(readLayout({ overviewLayout: layoutValue(layout) })).toEqual(layout);
  });
});

describe('moving, pinning and pruning', () => {
  it('moves an id up, down and to a place, clamped; an edge move is no move', () => {
    const list = ['a', 'b', 'c'];
    expect(moveBy(list, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(list, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveBy(list, 'a', -1)).toBe(list);
    expect(moveBy(list, 'c', 1)).toBe(list);
    expect(moveTo(list, 'a', 99)).toEqual(['b', 'c', 'a']);
    expect(moveTo(list, 'zzz', 0)).toBe(list);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('says where an id is', () => {
    expect(placeOf(['a', 'b', 'c'], 'b')).toBe('2 of 3');
  });

  it('pins at the end once, and unpins', () => {
    const pinned = ['a'];
    expect(pin(pinned, 'b')).toEqual(['a', 'b']);
    expect(pin(pinned, 'a')).toBe(pinned);
    expect(unpin(['a', 'b'], 'a')).toEqual(['b']);
    expect(unpin(pinned, 'zz')).toBe(pinned);
  });

  it('prunes the pins the check says are gone, and nothing before it can tell', () => {
    const layout = { order: [...REORDERABLE], pinned: ['a', 'gone', 'b'] };
    expect(pruneLayout(layout, (uid) => uid === 'gone').pinned).toEqual(['a', 'b']);
    expect(pruneLayout(layout, () => false)).toBe(layout);
    expect(pruneLayout(layout, null)).toBe(layout);
  });
});

const row = (uid, extra = {}) => ({
  id: `services/${uid}`,
  uid,
  name: uid,
  nodeName: 'Pi',
  ...extra,
});
const count = (rows) => `${rows.length} rows`;

describe('withPinned: the pinned group of the Services section', () => {
  const groups = [
    { key: 'node:pi-1', title: 'Pi 1', rows: [row('pi-1:a'), row('pi-1:b')], count: '2' },
    { key: 'node:pi-2', title: 'Pi 2', rows: [row('pi-2:c')], count: '1' },
  ];

  it('is the groups as they are with nothing pinned, or nothing pinned that has a row', () => {
    expect(withPinned(groups, [], count)).toBe(groups);
    expect(withPinned(groups, ['pi-9:gone'], count)).toBe(groups);
  });

  it('puts the pinned first, in the pinned order, and out of the group they were in', () => {
    const out = withPinned(groups, ['pi-2:c', 'pi-1:b'], count);
    expect(out.map((g) => g.key)).toEqual(['pinned', 'node:pi-1']);
    expect(out[0].title).toBe('Pinned');
    expect(out[0].rows.map((r) => r.uid)).toEqual(['pi-2:c', 'pi-1:b']);
    expect(out[0].rows[0].where).toBe('Pi');
    expect(out[1].rows.map((r) => r.uid)).toEqual(['pi-1:a']);
    expect(out[1].count).toBe('1 rows');
    // the input is untouched
    expect(groups[0].rows).toHaveLength(2);
  });

  it('skips a pinned uid that is gone and draws the rest', () => {
    const out = withPinned(groups, ['gone:x', 'pi-1:a'], count);
    expect(out[0].rows.map((r) => r.uid)).toEqual(['pi-1:a']);
  });

  it('keeps a pinned stack one row, with its folded members', () => {
    const stack = row('pi-1:web', { stack: { name: 'web' }, folded: [row('pi-1:db')] });
    const out = withPinned(
      [{ key: 'node:pi-1', title: 'Pi 1', rows: [stack, row('pi-1:a')] }],
      ['pi-1:web'],
      count
    );
    expect(out[0].rows).toHaveLength(1);
    expect(out[0].rows[0].stack).toBeTruthy();
    expect(out[0].rows[0].folded).toHaveLength(1);
  });

  it('drops a group the pinning emptied', () => {
    const out = withPinned(groups, ['pi-2:c'], count);
    expect(out.map((g) => g.key)).toEqual(['pinned', 'node:pi-1']);
  });
});

describe('assigning a service to a custom group', () => {
  const groups = [
    { id: 'g1', title: 'Media', containers: ['pi-1:a', 'pi-1:b'] },
    { id: 'g2', title: 'Net', containers: [] },
  ];

  it('puts a uid in the group and takes it out of every other', () => {
    const next = assignGroup(groups, 'pi-1:a', 'g2');
    expect(next[0].containers).toEqual(['pi-1:b']);
    expect(next[1].containers).toEqual(['pi-1:a']);
    expect(groups[0].containers).toEqual(['pi-1:a', 'pi-1:b']);
  });

  it('takes it out of its group with no target, and changes nothing twice', () => {
    expect(assignGroup(groups, 'pi-1:a', null)[0].containers).toEqual(['pi-1:b']);
    expect(assignGroup(groups, 'pi-1:a', 'g1')).toBe(groups);
    expect(assignGroup(groups, 'zz', null)).toBe(groups);
  });

  it('finds the group that holds a service, the first, and whether only by a name', () => {
    const held = (g) => g.containers;
    const named = (g) => (g.id === 'g2' ? ['pi-1:c'] : []);
    expect(groupOf(groups, 'pi-1:b', held, named)).toEqual({ group: groups[0], byName: false });
    expect(groupOf([{ id: 'g2', containers: ['pi-1:c'] }], 'pi-1:c', held, named).byName).toBe(
      true
    );
    expect(groupOf(groups, 'nope', held, named)).toEqual({ group: null, byName: false });
  });
});

describe('serviceGone: a pin goes only when its service is really gone', () => {
  const entity = (id) => ({ id: `services/${id}`, subsystem: 'services', kind: 'service' });
  const status = { entities: [entity('pi-1:web')] };
  const nodes = {
    'pi-1': { reachable: true },
    'pi-2': { reachable: false },
    'pi-3': { reachable: true, failedReads: ['containers'] },
  };

  it('cannot tell before the status or the cards are read', () => {
    expect(serviceGone(null, { nodes })).toBeNull();
    expect(serviceGone(status, null)).toBeNull();
    expect(serviceGone({}, { nodes })).toBeNull();
  });

  it('a service the model has is not gone', () => {
    expect(serviceGone(status, { nodes })('pi-1:web')).toBe(false);
  });

  it('absent from a node that answered in full is gone', () => {
    expect(serviceGone(status, { nodes })('pi-1:removed')).toBe(true);
  });

  it('absent from a node that is down, partly read, hidden or unknown is not gone', () => {
    const gone = serviceGone(status, { nodes });
    expect(gone('pi-2:web')).toBe(false);
    expect(gone('pi-3:web')).toBe(false);
    expect(gone('pi-9:web')).toBe(false);
    expect(gone('no-node')).toBe(false);
  });
});
