/*
 * The custom groups of Settings → Sections (#517): a group holds services by
 * uid, so the same container on two nodes is two services; a Kuma monitor with
 * no container is one too; and a group saved before #517 (bare container
 * names) reads as it always did, until Settings writes it back as uids.
 */
import { describe, expect, it } from 'vitest';
import {
  DEAD_GROUP_KEYS,
  dropDeadGroupKeys,
  groupChoices,
  heldByName,
  heldUids,
  migrateGroups,
  unmatchedEntries,
  withoutDeadGroupKeys,
} from './customGroups.js';
import { twoPis } from '../testing/statusFixtures.js';

describe('the services a group can hold (Settings → Sections lists them)', () => {
  it('every service the model has, a Kuma monitor with no container too, each with its node', () => {
    const choices = groupChoices(twoPis());
    expect(choices.services).toEqual([
      {
        uid: 'pi-1:Home Assistant',
        container: 'Home Assistant',
        name: 'Home Assistant',
        node: 'pi-1',
        nodeName: 'Pi 1',
      },
      {
        uid: 'pi-1:adguard-home',
        container: 'adguard-home',
        name: 'AdGuard Home',
        node: 'pi-1',
        nodeName: 'Pi 1',
      },
      {
        uid: 'pi-2:adguard-home',
        container: 'adguard-home',
        name: 'AdGuard Home',
        node: 'pi-2',
        nodeName: 'Pi 2',
      },
      {
        uid: 'pi-2:unbound',
        container: 'unbound',
        name: 'Unbound',
        node: 'pi-2',
        nodeName: 'Pi 2',
      },
    ]);
    expect([...choices.nodes].sort()).toEqual(['pi-1', 'pi-2']);
    expect(choices.complete).toBe(true);
  });

  // #517 review: a list missing a node's services can't tell a name holds none.
  it('is not complete while a node went unread or has no signal, a source is down, a node is hidden, or a list is missing', () => {
    const { status, services, serverConfig } = twoPis();
    const withNode = (key, extra) => ({
      ...services,
      nodes: { ...services.nodes, [key]: { ...services.nodes[key], ...extra } },
    });
    const incomplete = [
      twoPis({ pi2Unread: true }),
      { status, serverConfig, services: withNode('pi-2', { reachable: false }) },
      { status, serverConfig, services: { ...services, sources: { prometheus: { ok: false } } } },
      { status, serverConfig, services: { ...services, sources: { kuma: { ok: false } } } },
      {
        status,
        services,
        serverConfig: { nodes: { ...serverConfig.nodes, nas: { visible: false } } },
      },
      { status, services, serverConfig: { nodes: { ...serverConfig.nodes, nas: {} } } },
      { status, services, serverConfig: null },
      { status: null, services, serverConfig },
      { status, services: null, serverConfig },
    ];
    for (const [i, board] of incomplete.entries()) {
      expect(groupChoices(board).complete, `case ${i}`).toBe(false);
    }
    // A node services.yaml hides is still a node the server knows.
    const hidden = { nodes: { ...serverConfig.nodes, nas: { visible: false } } };
    expect(groupChoices({ status, services, serverConfig: hidden }).nodes.has('nas')).toBe(true);
  });

  it("without a status (none built yet), /api/services' cards", () => {
    const { services } = twoPis();
    const choices = groupChoices({ status: null, services });
    expect(choices.services.map((s) => s.uid)).toEqual([
      'pi-1:adguard-home',
      'pi-2:adguard-home',
      'pi-2:unbound',
    ]);
    expect(choices.services[1]).toMatchObject({ name: 'AdGuard Home', nodeName: 'Pi 2' });
  });

  it('neither answered: null, so nothing is resolved or rewritten against an empty list', () => {
    expect(groupChoices({ status: null, services: null })).toBeNull();
  });
});

describe('what a group holds', () => {
  const { services } = groupChoices(twoPis());

  it("a uid holds that node's service only, never its namesake on the other Pi", () => {
    expect(heldUids({ containers: ['pi-1:adguard-home'] }, services)).toEqual([
      'pi-1:adguard-home',
    ]);
  });

  it('a Kuma monitor with no container is held by its uid', () => {
    expect(heldUids({ containers: ['pi-1:Home Assistant'] }, services)).toEqual([
      'pi-1:Home Assistant',
    ]);
  });

  it('a bare name, as Settings saved before #517, holds every service of that name, as it always did', () => {
    expect(heldUids({ containers: ['adguard-home'] }, services)).toEqual([
      'pi-1:adguard-home',
      'pi-2:adguard-home',
    ]);
  });

  it('an entry nothing answers to holds nothing and is listed as such; a non-string is no entry', () => {
    const group = { containers: ['gone', 'pi-2:old-thing', 42, null, 'pi-1:adguard-home'] };
    expect(heldUids(group, services)).toEqual(['pi-1:adguard-home']);
    expect(unmatchedEntries(group, services)).toEqual(['gone', 'pi-2:old-thing']);
    expect(heldUids({}, services)).toEqual([]);
    expect(heldUids({ containers: 'adguard-home' }, services)).toEqual([]);
  });
});

describe('a saved group written back as uids (migrateGroups)', () => {
  const choices = groupChoices(twoPis());

  it('a bare name becomes the uids it reads as; a uid stays; a name that reads as none goes', () => {
    const groups = [
      { id: 'dns', title: 'DNS', containers: ['adguard-home', 'gone'] },
      { id: 'home', title: 'Home', containers: ['pi-1:Home Assistant'] },
    ];
    expect(migrateGroups(groups, choices)).toEqual([
      { id: 'dns', title: 'DNS', containers: ['pi-1:adguard-home', 'pi-2:adguard-home'] },
      { id: 'home', title: 'Home', containers: ['pi-1:Home Assistant'] },
    ]);
  });

  it('reads the same before and after: the same services, in each group', () => {
    const groups = [
      { id: 'a', title: 'A', containers: ['pi-2:adguard-home', 'Home Assistant'] },
      { id: 'b', title: 'B', containers: ['adguard-home'] },
    ];
    const migrated = migrateGroups(groups, choices);
    for (const [i, g] of groups.entries()) {
      expect(heldUids(migrated[i], choices.services)).toEqual(heldUids(g, choices.services));
    }
  });

  it('a uid on a node the server knows stays while no service has it (a node with no signal)', () => {
    const groups = [{ id: 'g', title: 'G', containers: ['pi-2:pihole', 'nowhere:pihole'] }];
    expect(migrateGroups(groups, choices)[0].containers).toEqual(['pi-2:pihole']);
  });

  it('is deterministic and settles: a second pass changes nothing, and keeps the same objects', () => {
    const once = migrateGroups([{ id: 'g', title: 'G', containers: ['adguard-home'] }], choices);
    expect(migrateGroups(once, choices)).toBe(once);
    expect(migrateGroups(once, choices)[0]).toBe(once[0]);
  });

  it("drops a group's dead keys, keeps the rest; one entry once", () => {
    const old = {
      id: 'g',
      title: 'G',
      icon: '📂',
      borderColor: '#7c5cff',
      hidden: true,
      note: 'kept',
      containers: ['adguard-home', 'pi-1:adguard-home'],
    };
    expect(migrateGroups([old], choices)).toEqual([
      { id: 'g', title: 'G', note: 'kept', containers: ['pi-1:adguard-home', 'pi-2:adguard-home'] },
    ]);
  });

  it('with no service list (none read, or no node known), the groups as they are', () => {
    const groups = [{ id: 'g', title: 'G', containers: ['adguard-home'] }];
    expect(migrateGroups(groups, null)).toBe(groups);
    expect(migrateGroups(groups, { services: [], nodes: new Set(), complete: true })).toBe(groups);
  });

  // #517 review: pi-2's containers unread this cycle. Rewriting every group
  // then must lose neither pi-2's AdGuard Home (held by the name) nor a
  // pi-2-only name (Unbound).
  it('with a node unread: a name stays beside the uids it holds, a name that holds none stays, nothing is lost', () => {
    const unread = groupChoices(twoPis({ pi2Unread: true }));
    expect(unread.complete).toBe(false);
    const groups = [
      { id: 'dns', title: 'DNS', icon: '📂', containers: ['adguard-home', 'unbound'] },
    ];
    const migrated = migrateGroups(groups, unread);
    expect(migrated).toEqual([
      { id: 'dns', title: 'DNS', containers: ['adguard-home', 'pi-1:adguard-home', 'unbound'] },
    ]);
    expect(migrateGroups(migrated, unread)).toBe(migrated);
    // Back once pi-2 is read: the names hold both of its services, then go.
    const read = groupChoices(twoPis());
    const later = migrateGroups(migrated, read);
    expect(later[0].containers).toEqual(['pi-1:adguard-home', 'pi-2:adguard-home', 'pi-2:unbound']);
    expect(heldUids(later[0], read.services)).toEqual(heldUids(groups[0], read.services));
    // Settings can't take out a service a kept name holds, by its uid too or not.
    expect(heldByName(groups[0], unread.services)).toEqual(['pi-1:adguard-home']);
    expect(heldByName(migrated[0], unread.services)).toEqual(['pi-1:adguard-home']);
    expect(heldByName(later[0], read.services)).toEqual([]);
  });
});

describe("a group's dead keys (#295 removed its colour; #307 moved show/hide)", () => {
  it('the icon, the colour and hidden', () => {
    expect(DEAD_GROUP_KEYS).toEqual(['icon', 'borderColor', 'hidden']);
  });

  it('dropped from each group that has one; the same array when none has', () => {
    const live = { id: 'b', title: 'B', containers: ['x'] };
    const groups = [
      { id: 'a', icon: '📂', borderColor: '#fff', hidden: false, containers: [] },
      live,
    ];
    const next = withoutDeadGroupKeys(groups);
    expect(next).toEqual([{ id: 'a', containers: [] }, live]);
    expect(next[1]).toBe(live);
    expect(withoutDeadGroupKeys([live])).toEqual([live]);
    const clean = [live];
    expect(withoutDeadGroupKeys(clean)).toBe(clean);
    expect(withoutDeadGroupKeys(undefined)).toBeUndefined();
  });

  it("the display config without them, nor the old board's panel settings for a group; the same object when it has none", () => {
    const config = {
      theme: 'dark',
      customGroups: [
        {
          id: 'custom-1',
          title: 'DNS',
          icon: '📂',
          borderColor: '#7c5cff',
          hidden: true,
          containers: ['adguard-home'],
        },
        { id: 'custom-2', title: 'Media', containers: ['apps:jellyfin'] },
      ],
      sections: { 'group-custom-1': { visible: false }, ups: { visible: false } },
    };
    const next = dropDeadGroupKeys(config);
    expect(next).toEqual({
      theme: 'dark',
      customGroups: [
        { id: 'custom-1', title: 'DNS', containers: ['adguard-home'] },
        { id: 'custom-2', title: 'Media', containers: ['apps:jellyfin'] },
      ],
      sections: { ups: { visible: false } },
    });
    expect(next.customGroups[1]).toBe(config.customGroups[1]);
    expect(config.customGroups[0].icon).toBe('📂');
    expect(dropDeadGroupKeys(next)).toBe(next);
    expect(dropDeadGroupKeys(null)).toBeNull();
  });
});

describe('a monitor no container carries that moves to another node (#644)', () => {
  const svc = (uid, more = {}) => ({ uid, container: uid.slice(uid.indexOf(':') + 1), name: uid, ...more });
  const moved = [svc('nas:NAS (Ping)', { monitorOnly: true }), svc('pi-2:adguard-home')];
  const group = { id: 'g', title: 'G', containers: ['vm101:NAS (Ping)', 'vm101:adguard-home'] };
  const choices = (complete) => ({ services: moved, nodes: new Set(['vm101', 'nas', 'pi-2']), complete });

  it('a group holding its old uid still lists it, on the new node', () => {
    expect(heldUids(group, moved)).toEqual(['nas:NAS (Ping)']);
    expect(unmatchedEntries(group, moved)).toEqual(['vm101:adguard-home']);
  });

  it('only a monitor-only service is followed, never a container of the same name elsewhere', () => {
    const g = { id: 'g', title: 'G', containers: ['vm101:adguard-home'] };
    expect(heldUids(g, moved)).toEqual([]);
  });

  it('Settings rewrites the entry to the new uid when every node is read', () => {
    const [out] = migrateGroups([group], choices(true));
    expect(out.containers).toEqual(['nas:NAS (Ping)', 'vm101:adguard-home']);
  });

  it('the entry is kept beside the new uid while the list is not whole', () => {
    const [out] = migrateGroups([group], choices(false));
    expect(out.containers).toEqual(['vm101:NAS (Ping)', 'nas:NAS (Ping)', 'vm101:adguard-home']);
  });
});
