import { describe, it, expect } from 'vitest';
import { boardSections, filterLayouts } from './boardFilter.js';

// The Overview's board, filtered to a subsystem from the strip (#298): which
// of today's panels each subsystem keeps, and the layout they keep.

const PANELS = [
  'node-edge',
  'node-apps',
  'node-pve',
  'group-media',
  'ups',
  'pipeline',
  'todos',
  'cron-jobs',
  'quicklaunch',
];
// pve has no service cards of its own (a hypervisor with only VMs).
const nodesWithServices = new Set(['node-edge', 'node-apps']);
const kept = (subsystem) =>
  PANELS.filter(boardSections(subsystem, { nodesWithServices }) ?? (() => true));

describe('boardSections', () => {
  it('no filter keeps every panel', () => {
    expect(boardSections(null, { nodesWithServices })).toBeNull();
  });

  it('Services keeps the panels that draw service cards: nodes with services, and groups', () => {
    expect(kept('services')).toEqual(['node-edge', 'node-apps', 'group-media']);
  });

  it('Nodes keeps the node cards', () => {
    expect(kept('nodes')).toEqual(['node-edge', 'node-apps', 'node-pve']);
  });

  it('Power keeps the UPS panel', () => {
    expect(kept('power')).toEqual(['ups']);
  });

  it('Jobs and Backups keep Scheduled Jobs, where the board lists backups as jobs', () => {
    expect(kept('jobs')).toEqual(['cron-jobs']);
    expect(kept('backups')).toEqual(['cron-jobs']);
  });

  it('Integrations, or a subsystem the board does not know, keeps nothing', () => {
    expect(kept('integrations')).toEqual([]);
    expect(kept('storage')).toEqual([]);
  });
});

describe('filterLayouts', () => {
  const layouts = {
    lg: [
      { i: 'node-edge', x: 0, y: 0, w: 8, h: 8 },
      { i: 'node-apps', x: 8, y: 0, w: 16, h: 8 },
      { i: 'ups', x: 0, y: 8, w: 12, h: 5 },
      { i: 'cron-jobs', x: 12, y: 8, w: 12, h: 7 },
    ],
    sm: [
      { i: 'node-edge', x: 0, y: 0, w: 1, h: 8 },
      { i: 'ups', x: 0, y: 8, w: 1, h: 5 },
      { i: 'cron-jobs', x: 0, y: 13, w: 1, h: 7 },
    ],
  };

  it('keeps the panels shown at every breakpoint, risen into the space left', () => {
    expect(filterLayouts(layouts, new Set(['cron-jobs']))).toEqual({
      lg: [{ i: 'cron-jobs', x: 12, y: 0, w: 12, h: 7 }],
      sm: [{ i: 'cron-jobs', x: 0, y: 0, w: 1, h: 7 }],
    });
  });

  it('raises a panel only as far as the panels still above it in its columns', () => {
    expect(filterLayouts(layouts, new Set(['node-edge', 'cron-jobs'])).lg).toEqual([
      { i: 'node-edge', x: 0, y: 0, w: 8, h: 8 },
      { i: 'cron-jobs', x: 12, y: 0, w: 12, h: 7 },
    ]);
    expect(filterLayouts(layouts, new Set(['node-apps', 'ups'])).lg).toEqual([
      { i: 'node-apps', x: 8, y: 0, w: 16, h: 8 },
      { i: 'ups', x: 0, y: 8, w: 12, h: 5 },
    ]);
  });
});
