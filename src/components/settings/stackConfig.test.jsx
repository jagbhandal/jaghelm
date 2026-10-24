import { describe, it, expect } from 'vitest';
import { stackSetting, withStackLead, withStackSplit, withStackUngroup } from './servicesConfig.js';

// How Settings and the stack panel edit services.yaml's `stacks:` (#642): per
// node and project, every function gives back the whole config and leaves the
// one it was given alone.

const base = { nodes: { vm103: {} }, services: { gitea: { monitor: 'Gitea' } } };

describe('stacks override', () => {
  it('reads the defaults of a stack with no entry', () => {
    expect(stackSetting(base, 'vm103', 'immich')).toEqual({
      lead: null,
      ungroup: false,
      split: [],
    });
  });

  it('set lead writes node:project, and clearing it leaves no entry behind', () => {
    const led = withStackLead(base, 'vm103', 'Immich', 'immich_postgres');
    expect(led.stacks).toEqual({ 'vm103:immich': { lead: 'immich_postgres' } });
    expect(stackSetting(led, 'vm103', 'immich').lead).toBe('immich_postgres');
    const cleared = withStackLead(led, 'vm103', 'immich', null);
    expect(cleared).toEqual(base);
    expect('stacks' in cleared).toBe(false);
    // The config it was given is untouched.
    expect(base.stacks).toBeUndefined();
  });

  it('ungroup is per node: the same project on another node is left alone', () => {
    const one = withStackUngroup(base, 'vm103', 'immich', true);
    const both = withStackUngroup(one, 'vm101', 'immich', true);
    expect(both.stacks).toEqual({
      'vm103:immich': { ungroup: true },
      'vm101:immich': { ungroup: true },
    });
    expect(withStackUngroup(both, 'vm103', 'immich', false).stacks).toEqual({
      'vm101:immich': { ungroup: true },
    });
  });

  it('split out and back in, sorted, with the other settings kept', () => {
    let c = withStackLead(base, 'vm103', 'immich', 'immich_server');
    c = withStackSplit(c, 'vm103', 'immich', 'immich_redis', true);
    c = withStackSplit(c, 'vm103', 'immich', 'immich_postgres', true);
    expect(c.stacks['vm103:immich']).toEqual({
      lead: 'immich_server',
      split: ['immich_postgres', 'immich_redis'],
    });
    c = withStackSplit(c, 'vm103', 'immich', 'immich_redis', false);
    expect(c.stacks['vm103:immich'].split).toEqual(['immich_postgres']);
  });

  it('making a split container the lead, or the lead split, never leaves both', () => {
    let c = withStackSplit(base, 'vm103', 'immich', 'immich_redis', true);
    c = withStackLead(c, 'vm103', 'immich', 'immich_redis');
    expect(c.stacks['vm103:immich']).toEqual({ lead: 'immich_redis' });
    c = withStackSplit(c, 'vm103', 'immich', 'immich_redis', true);
    expect(c.stacks['vm103:immich']).toEqual({ split: ['immich_redis'] });
  });

  it('a hand-edited entry of the wrong type reads as the defaults, and never throws', () => {
    for (const bad of [
      null,
      'x',
      5,
      [],
      { 'vm103:immich': 'oops' },
      { 'vm103:immich': { lead: 3, split: 'a' } },
    ]) {
      expect(stackSetting({ stacks: bad }, 'vm103', 'immich')).toEqual({
        lead: null,
        ungroup: false,
        split: [],
      });
      expect(() => withStackUngroup({ stacks: bad }, 'vm103', 'immich', true)).not.toThrow();
    }
  });
});
