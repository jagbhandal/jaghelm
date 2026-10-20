import { describe, it, expect } from 'vitest';
import { ageText, alertsBadge, countsText, issueRows, whereOf } from './statusView.js';

const NOW = 1_782_345_600_000;

describe('statusView', () => {
  it('says where an issue is from its kind and node', () => {
    expect(whereOf({ kind: 'service', node: 'vm103' })).toBe('Service · vm103');
    expect(whereOf({ kind: 'node' })).toBe('Node');
    expect(whereOf({ kind: 'ups' })).toBe('Power');
    expect(whereOf({ kind: 'source' })).toBe('Monitoring source');
    expect(whereOf({ kind: 'mystery' })).toBeUndefined();
  });

  it('ages an issue from its since', () => {
    expect(ageText(30_000)).toBe('30 s');
    expect(ageText(4 * 60_000)).toBe('4 m');
    expect(ageText(3 * 3_600_000)).toBe('3 h');
    expect(ageText(50 * 3_600_000)).toBe('2 d');
    expect(ageText(-5)).toBe('0 s');
  });

  it("maps the model's issues to issue rows", () => {
    const status = {
      issues: [
        {
          id: 'services/vm103:immich',
          kind: 'service',
          node: 'vm103',
          name: 'Immich',
          state: 'crit',
          word: 'Down',
          reason: 'Kuma: HTTP 502',
          since: NOW - 4 * 60_000,
        },
        { id: 'power/ups', kind: 'ups', name: 'UPS', state: 'crit', word: 'On battery' },
      ],
    };
    expect(issueRows(status, NOW)).toEqual([
      {
        id: 'services/vm103:immich',
        state: 'crit',
        word: 'Down',
        title: 'Immich',
        where: 'Service · vm103',
        reason: 'Kuma: HTTP 502',
        age: '4 m',
      },
      {
        id: 'power/ups',
        state: 'crit',
        word: 'On battery',
        title: 'UPS',
        where: 'Power',
        reason: undefined,
        age: undefined,
      },
    ]);
    expect(issueRows(null)).toEqual([]);
  });

  it('counts the issues by state', () => {
    const at = (state) => ({ state });
    expect(countsText([at('crit'), at('crit'), at('warn'), at('warn'), at('unknown')])).toBe(
      '2 critical, 2 warnings, 1 no signal'
    );
    expect(countsText([at('warn')])).toBe('1 warning');
    expect(countsText([])).toBe('');
  });

  it("badges Alerts with the count, in the worst issue's state, only with a signal", () => {
    const status = { issues: [{ state: 'warn' }, { state: 'unknown' }] };
    expect(alertsBadge(status, 'ok')).toEqual({ count: 2, state: 'warn', label: '2 issues' });
    expect(alertsBadge({ issues: [{ state: 'crit' }] }, 'ok').label).toBe('1 issue');
    expect(alertsBadge(status, 'down')).toBeNull();
    expect(alertsBadge({ issues: [] }, 'ok')).toBeNull();
    expect(alertsBadge(null, 'loading')).toBeNull();
  });
});
