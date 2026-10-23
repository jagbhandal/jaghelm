import { describe, expect, it } from 'vitest';
import { SLOW_EVERY, slowReadOf } from './tickBudget.js';

// Spec §4 (#306): at most 4 requests a tick. The two slow reads take turns,
// one tick in three each, never the same tick.
describe('slowReadOf', () => {
  it('gives history ticks 1, 4, 7 …, the Pipeline ticks 2, 5, 8 …, and none the rest', () => {
    expect(SLOW_EVERY).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(slowReadOf)).toEqual([
      null,
      'history',
      'pipeline',
      null,
      'history',
      'pipeline',
      null,
      'history',
      'pipeline',
    ]);
  });

  it('never gives one tick both', () => {
    for (let tick = 0; tick < 100; tick += 1) {
      const turn = slowReadOf(tick);
      expect([null, 'history', 'pipeline']).toContain(turn);
    }
  });
});
