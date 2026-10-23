import { describe, expect, it } from 'vitest';
import { SLOW_EVERY, slowReadOf } from './tickBudget.js';

// Spec §4 (#306): at most 4 requests a tick. The two slow reads take turns,
// one tick in three each, never the same tick.
describe('slowReadOf', () => {
  it('gives history ticks 1, 4, 7 …, the Pipeline 2, 5, 8 …, and the weather 3, 6, 9 …', () => {
    expect(SLOW_EVERY).toBe(3);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(slowReadOf)).toEqual([
      'history',
      'pipeline',
      'weather',
      'history',
      'pipeline',
      'weather',
      'history',
      'pipeline',
      'weather',
    ]);
  });

  it('gives each tick one, never two', () => {
    for (let tick = 0; tick < 100; tick += 1) {
      expect(['history', 'pipeline', 'weather']).toContain(slowReadOf(tick));
    }
  });
});
