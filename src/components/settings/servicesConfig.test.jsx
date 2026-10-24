import { describe, it, expect } from 'vitest';
import {
  AUTO_MATCH,
  NO_MONITOR,
  effectiveText,
  isHidden,
  isPerNode,
  monitorChoice,
  monitorNodeSetting,
  withHidden,
  withMonitorNode,
  withMonitor,
  withNodeMonitor,
  withNodeText,
  withText,
  withoutOverrides,
} from './servicesConfig.js';

// How Settings edits services.yaml (#633, #636, #240, #319): every function
// gives back the whole config and leaves the one it was given alone.

const svc = { container: 'gateway-npm' };
const LIVE = {
  nodes: { pi1: { services: [svc] }, pi2: { services: [svc] } },
};
const cfg = (services = {}) => ({
  services,
  nodes: { pi1: { display_name: 'Pi One' }, pi2: { display_name: 'Pi Two' } },
});
const entry = (config) => config.services['gateway-npm'];

describe('monitor per node', () => {
  it('editing pi2 writes monitor_per_node.pi2 and leaves pi1 alone, migrating the container-wide value', () => {
    const out = withNodeMonitor(
      cfg({ 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi1: 'NPM A' } } }),
      LIVE,
      'gateway-npm',
      'pi2',
      'NPM B'
    );
    expect(entry(out)).toEqual({ monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' } });
  });

  it('reads the node entry, else the container-wide monitor', () => {
    const config = cfg({ 'gateway-npm': { monitor: 'NPM A', monitor_per_node: { pi2: 'NPM B' } } });
    expect(monitorChoice(config, 'gateway-npm', 'pi2', true)).toBe('NPM B');
    expect(monitorChoice(config, 'gateway-npm', 'pi1', true)).toBe('NPM A');
  });

  it('false is No monitor, per node and container-wide, never Auto-match', () => {
    expect(
      monitorChoice(cfg({ 'gateway-npm': { monitor_per_node: { pi1: false }, monitor: 'NPM A' } }), 'gateway-npm', 'pi1', true)
    ).toBe(NO_MONITOR);
    expect(monitorChoice(cfg({ 'gateway-npm': { monitor: false } }), 'gateway-npm', 'pi2', true)).toBe(NO_MONITOR);
    expect(monitorChoice(cfg(), 'gateway-npm', 'pi2', true)).toBe(AUTO_MATCH);
  });

  it('Auto-match removes only this node entry', () => {
    const out = withNodeMonitor(
      cfg({ 'gateway-npm': { monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' } } }),
      LIVE,
      'gateway-npm',
      'pi2',
      AUTO_MATCH
    );
    expect(entry(out)).toEqual({ monitor_per_node: { pi1: 'NPM A' } });
  });

  it('Auto-match on the last entry drops the empty map and the empty override', () => {
    const out = withNodeMonitor(cfg({ 'gateway-npm': { monitor_per_node: { pi2: 'NPM B' } } }), LIVE, 'gateway-npm', 'pi2', AUTO_MATCH);
    expect(out.services).toEqual({});
  });

  it('Auto-match keeps display_name when it drops the last per-node entry', () => {
    const out = withNodeMonitor(
      cfg({ 'gateway-npm': { display_name: 'Proxy', monitor_per_node: { pi2: 'NPM B' } } }),
      LIVE,
      'gateway-npm',
      'pi2',
      AUTO_MATCH
    );
    expect(entry(out)).toEqual({ display_name: 'Proxy' });
  });

  it('migrates a container-wide monitor to the other nodes on the first per-node write', () => {
    const out = withNodeMonitor(cfg({ 'gateway-npm': { monitor: 'Dead NPM' } }), LIVE, 'gateway-npm', 'pi2', 'NPM B');
    expect(entry(out)).toEqual({ monitor_per_node: { pi1: 'Dead NPM', pi2: 'NPM B' } });
  });

  it('Auto-match clears past a dead container-wide monitor (migrate, then clear)', () => {
    const out = withNodeMonitor(cfg({ 'gateway-npm': { monitor: 'Dead NPM' } }), LIVE, 'gateway-npm', 'pi1', AUTO_MATCH);
    expect(entry(out)).toEqual({ monitor_per_node: { pi2: 'Dead NPM' } });
  });

  it('choosing No monitor on one node writes false for that node only', () => {
    const out = withNodeMonitor(cfg({ 'gateway-npm': { monitor_per_node: { pi1: 'NPM A' } } }), LIVE, 'gateway-npm', 'pi2', NO_MONITOR);
    expect(entry(out)).toEqual({ monitor_per_node: { pi1: 'NPM A', pi2: false } });
  });

  it('a container-wide false migrates as false', () => {
    const out = withNodeMonitor(cfg({ 'gateway-npm': { monitor: false } }), LIVE, 'gateway-npm', 'pi1', 'NPM A');
    expect(entry(out)).toEqual({ monitor_per_node: { pi1: 'NPM A', pi2: false } });
  });

  it('stays per-node when the other node is offline or hidden (no live row)', () => {
    const live = { nodes: { pi1: LIVE.nodes.pi1 } };
    const config = cfg({ 'gateway-npm': { monitor_per_node: { pi1: 'NPM A', pi2: 'NPM B' } } });
    expect(isPerNode(config, live, new Set(), 'gateway-npm')).toBe(true);
    expect(entry(withNodeMonitor(config, live, 'gateway-npm', 'pi1', 'NPM B'))).toEqual({
      monitor_per_node: { pi1: 'NPM B', pi2: 'NPM B' },
    });
  });

  it('a container on one node writes and clears the container-wide monitor', () => {
    const live = { nodes: { pi1: LIVE.nodes.pi1 } };
    expect(isPerNode(cfg(), live, new Set(), 'gateway-npm')).toBe(false);
    const set = withMonitor(cfg(), 'gateway-npm', 'Redis');
    expect(entry(set)).toEqual({ monitor: 'Redis' });
    expect(entry(withMonitor(set, 'gateway-npm', NO_MONITOR))).toEqual({ monitor: false });
    expect(withMonitor(set, 'gateway-npm', AUTO_MATCH).services).toEqual({});
  });

  it('does not change the config it was given', () => {
    const config = cfg({ 'gateway-npm': { monitor: 'NPM A' } });
    const before = structuredClone(config);
    withNodeMonitor(config, LIVE, 'gateway-npm', 'pi1', 'NPM B');
    withMonitor(config, 'gateway-npm', 'X');
    expect(config).toEqual(before);
  });
});

describe('display name and icon per node', () => {
  it('renaming pi1 writes display_name_per_node.pi1 only', () => {
    const out = withNodeText(cfg(), LIVE, 'gateway-npm', 'pi1', 'display_name', 'NPM Primary');
    expect(entry(out)).toEqual({ display_name_per_node: { pi1: 'NPM Primary' } });
  });

  it('the icon is per node too', () => {
    const out = withNodeText(cfg({ 'gateway-npm': { icon_per_node: { pi2: 'b' } } }), LIVE, 'gateway-npm', 'pi1', 'icon', 'a');
    expect(entry(out)).toEqual({ icon_per_node: { pi1: 'a', pi2: 'b' } });
  });

  it("shows this node's value, else the container-wide one", () => {
    const config = cfg({ 'gateway-npm': { display_name: 'Proxy', display_name_per_node: { pi1: 'Primary' } } });
    expect(effectiveText(config, 'gateway-npm', 'pi1', 'display_name')).toBe('Primary');
    expect(effectiveText(config, 'gateway-npm', 'pi2', 'display_name')).toBe('Proxy');
  });

  it('clearing one node removes only its entry; empty maps and entries are dropped', () => {
    const two = withNodeText(
      cfg({ 'gateway-npm': { display_name_per_node: { pi1: 'A', pi2: 'B' } } }),
      LIVE,
      'gateway-npm',
      'pi1',
      'display_name',
      ''
    );
    expect(entry(two)).toEqual({ display_name_per_node: { pi2: 'B' } });
    const one = withNodeText(cfg({ 'gateway-npm': { display_name_per_node: { pi1: 'A' } } }), LIVE, 'gateway-npm', 'pi1', 'display_name', '');
    expect(one.services).toEqual({});
  });

  it('migrates a container-wide name to the other nodes on the first per-node write', () => {
    const out = withNodeText(cfg({ 'gateway-npm': { display_name: 'Proxy', icon: 'npm' } }), LIVE, 'gateway-npm', 'pi2', 'display_name', 'Secondary');
    expect(entry(out)).toEqual({ icon: 'npm', display_name_per_node: { pi1: 'Proxy', pi2: 'Secondary' } });
  });

  it('clearing a node after migration really clears it (no container-wide fallback)', () => {
    const out = withNodeText(cfg({ 'gateway-npm': { display_name: 'Proxy' } }), LIVE, 'gateway-npm', 'pi1', 'display_name', '');
    expect(entry(out)).toEqual({ display_name_per_node: { pi2: 'Proxy' } });
  });

  it('migration copies a container-wide name to a node whose hand-edited entry is null', () => {
    const out = withNodeText(
      cfg({ 'gateway-npm': { display_name: 'Proxy', display_name_per_node: { pi1: null } } }),
      LIVE,
      'gateway-npm',
      'pi2',
      'display_name',
      'S'
    );
    expect(entry(out)).toEqual({ display_name_per_node: { pi1: 'Proxy', pi2: 'S' } });
  });

  it('a container on one node writes the plain keys; an empty value clears the key', () => {
    const set = withText(cfg(), 'redis', 'display_name', 'Cache');
    expect(set.services.redis).toEqual({ display_name: 'Cache' });
    expect(withText(set, 'redis', 'display_name', '').services).toEqual({});
  });

  it('Remove all overrides clears the per-node maps too', () => {
    const config = cfg({
      'gateway-npm': { display_name_per_node: { pi1: 'A' }, icon_per_node: { pi1: 'x' }, monitor_per_node: { pi1: 'NPM A' } },
      redis: { monitor: 'Redis' },
    });
    expect(withoutOverrides(config, 'gateway-npm').services).toEqual({ redis: { monitor: 'Redis' } });
  });
});

describe('hide rules match a container by its exact name', () => {
  const nodes = (hide) => ({ nodes: { gateway: { hide } }, services: {} });

  it('hiding "redis" adds only "redis"', () => {
    expect(withHidden(nodes([]), 'gateway', 'redis').nodes.gateway.hide).toEqual(['redis']);
  });

  it('"redis" is hidden, "redis-backup" is not, when only "redis" is hidden', () => {
    expect(isHidden(nodes(['redis']), 'gateway', 'redis')).toBe(true);
    expect(isHidden(nodes(['redis']), 'gateway', 'redis-backup')).toBe(false);
  });

  it('un-hiding "redis" leaves the "redis-backup" rule', () => {
    expect(withHidden(nodes(['redis', 'redis-backup']), 'gateway', 'redis').nodes.gateway.hide).toEqual(['redis-backup']);
  });

  it('a name matches whatever its case', () => {
    expect(isHidden(nodes(['Redis']), 'gateway', 'redis')).toBe(true);
  });
});

describe('monitor_nodes (#644)', () => {
  it('writes a monitor name to a node key, replacing its entry without regard to case, and leaves the rest', () => {
    const base = { ...cfg({ x: { monitor: 'X' } }), monitor_nodes: { other: 'pi2', 'CADVISOR-pi1': 'pi2' } };
    const next = withMonitorNode(base, 'cadvisor-pi1', 'pi1');
    expect(next.monitor_nodes).toEqual({ other: 'pi2', 'cadvisor-pi1': 'pi1' });
    expect(next.services).toBe(base.services);
    expect(base.monitor_nodes['CADVISOR-pi1']).toBe('pi2'); // the argument is untouched
  });

  it('null clears the entry, and the last one takes the map with it', () => {
    const base = { ...cfg(), monitor_nodes: { a: 'pi1', b: 'pi2' } };
    expect(withMonitorNode(base, 'a', null).monitor_nodes).toEqual({ b: 'pi2' });
    expect('monitor_nodes' in withMonitorNode(withMonitorNode(base, 'a', null), 'b', null)).toBe(false);
    expect(withMonitorNode(cfg(), 'a', null)).toEqual(cfg());
  });

  it('reads a setting without regard to case; junk reads as none', () => {
    expect(monitorNodeSetting({ monitor_nodes: { 'Cadvisor-Pi1': 'pi1' } }, 'cadvisor-pi1')).toBe('pi1');
    for (const bad of [{}, { monitor_nodes: 'pi1' }, { monitor_nodes: ['pi1'] }, { monitor_nodes: { a: 5 } }, { monitor_nodes: { a: '' } }, null]) {
      expect(monitorNodeSetting(bad, 'a')).toBeNull();
    }
  });
});
