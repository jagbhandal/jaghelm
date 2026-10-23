import { describe, expect, it } from 'vitest';
import { hasPower, powerCount, powerRows } from './powerView.js';
import { HEALTHY } from '../testing/statusFixtures.js';

// The Overview's Power section (#306): the UPS from the status model alone.
const ups = (overrides) => ({
  id: 'power/ups',
  kind: 'ups',
  subsystem: 'power',
  name: 'Back-UPS ES 600',
  state: 'ok',
  word: 'On mains',
  reason: 'On mains',
  metric: { name: 'charge', value: 100, unit: '%' },
  runtimeMinutes: null,
  ...overrides,
});
const statusWith = (entity, power = { id: 'power', detail: 'On mains' }) => ({
  entities: [entity],
  subsystems: [power],
});

describe('powerRows', () => {
  it('on mains: the charge as its detail, muted, no meta', () => {
    expect(powerRows({ status: statusWith(ups()) })).toEqual([
      {
        id: 'power/ups',
        name: 'Back-UPS ES 600',
        where: null,
        level: 'ok',
        state: 'ok',
        word: 'On mains',
        detail: '100 % charge',
        meta: '—',
        muted: true,
      },
    ]);
  });

  it('on battery: the model’s reason, and the minutes left', () => {
    const [row] = powerRows({
      status: statusWith(
        ups({
          state: 'crit',
          word: 'On battery',
          reason: 'On battery (82 % charge)',
          metric: { name: 'charge', value: 82, unit: '%' },
          runtimeMinutes: 31,
        })
      ),
    });
    expect(row).toMatchObject({
      state: 'crit',
      word: 'On battery',
      detail: 'On battery (82 % charge)',
      meta: '31 min left',
    });
  });

  it('stale: no signal, its words kept, and no countdown', () => {
    const [row] = powerRows({
      status: statusWith(
        ups({ state: 'crit', word: 'On battery', reason: 'On battery', runtimeMinutes: 9 })
      ),
      freshness: { stale: true },
    });
    expect(row).toMatchObject({ level: 'crit', state: 'unknown', word: 'On battery', meta: '—' });
  });

  it('a UPS with no charge reading says the model’s reason; no name, "UPS"', () => {
    const [row] = powerRows({ status: statusWith(ups({ metric: undefined, name: '' })) });
    expect(row).toMatchObject({ name: 'UPS', detail: 'On mains' });
  });

  it('none without a UPS in the model', () => {
    expect(powerRows({ status: { entities: [] } })).toEqual([]);
    expect(powerRows({ status: null })).toEqual([]);
    expect(hasPower(null)).toBe(false);
    expect(hasPower(HEALTHY)).toBe(true);
  });
});

describe('powerCount', () => {
  it('the Power subsystem’s words, or how old they are when stale', () => {
    expect(powerCount(statusWith(ups()))).toBe('On mains');
    expect(
      powerCount(statusWith(ups()), { stale: true, note: 'No signal · last known 3 min ago' })
    ).toBe('No signal · last known 3 min ago');
    expect(powerCount({ entities: [] })).toBeNull();
  });
});
