import { describe, it, expect } from 'vitest';
import { boardSections, filterLayouts } from './boardFilter.js';

// The Overview's board, filtered to a subsystem from the strip (#298): which
// of today's panels each subsystem keeps, and the layout they keep.

const PANELS = [
  'node-edge',
  'node-apps',
  'node-pve',
  'node-pi',
  'ups',
  'pipeline',
  'todos',
  'cron-jobs',
  'quicklaunch',
];
const kept = (subsystem) => PANELS.filter(boardSections(subsystem) ?? (() => true));

describe('boardSections', () => {
  it('no filter keeps every panel', () => {
    expect(boardSections(null)).toBeNull();
  });

  it('Services keeps no panel: the Services section above the board is theirs (#300)', () => {
    expect(kept('services')).toEqual([]);
  });

  it('Nodes keeps the node panels, and a saved node still loading', () => {
    expect(kept('nodes')).toEqual(['node-edge', 'node-apps', 'node-pve', 'node-pi']);
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
