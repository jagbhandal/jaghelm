import { describe, it, expect } from 'vitest';
import {
  ageText,
  alertsBadge,
  countsText,
  issueRows,
  subsystemCells,
  subsystemFilter,
  whereOf,
} from './statusView.js';
import { CONFIG_BROKEN, scenarioStatus } from '../../server/testing/statusScenarios.js';

const NOW = 1_782_345_600_000;

describe('statusView', () => {
  it('says where an issue is from its kind and node', () => {
    expect(whereOf({ kind: 'service', node: 'vm103' })).toBe('Service · vm103');
    expect(whereOf({ kind: 'node' })).toBe('Node');
    expect(whereOf({ kind: 'ups' })).toBe('Power');
    expect(whereOf({ kind: 'source' })).toBe('Monitoring source');
    expect(whereOf({ kind: 'mystery' })).toBeUndefined();
  });

  it("puts a broken services.yaml under Configuration, not a monitoring source (#505)", () => {
    expect(whereOf({ id: 'sources/config', kind: 'source' })).toBe('Configuration');
    expect(whereOf({ id: 'sources/prometheus', kind: 'source' })).toBe('Monitoring source');
    // The model's own issue for it, through the row the Alerts page and the attention panel draw.
    const status = scenarioStatus('config-broken', { now: NOW });
    expect(issueRows(status, NOW)).toEqual([
      {
        id: 'sources/config',
        state: 'warn',
        word: 'Failed',
        title: 'JagHelm config',
        where: 'Configuration',
        reason: CONFIG_BROKEN,
        age: '0 s',
      },
    ]);
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

  it("badges Alerts with the count, in the worst issue's state, only while the status is fresh", () => {
    const status = { issues: [{ state: 'warn' }, { state: 'unknown' }] };
    expect(alertsBadge(status, false)).toEqual({ count: 2, state: 'warn', label: '2 issues' });
    expect(alertsBadge({ issues: [{ state: 'crit' }] }, false).label).toBe('1 issue');
    expect(alertsBadge(status, true)).toBeNull();
    expect(alertsBadge({ issues: [] }, false)).toBeNull();
    expect(alertsBadge(null, false)).toBeNull();
  });
});

// The Overview's subsystem strip (#298): the model's subsystems as they are,
// checked against /api/status as the server's own model builds it
// (server/testing/statusScenarios.js), never against numbers written here.
describe('the subsystem strip, from the model', () => {
  const at = (name) => scenarioStatus(name, { now: NOW });

  /** The model's word for a subsystem: its worst entity's, the ranked issues first. */
  function modelWord(status, subsystem) {
    const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
    return (status.issues.find(match) ?? status.entities.find(match)).word;
  }

  for (const name of ['healthy', 'incident', 'every-state', 'source-down']) {
    it(`${name}: a cell per subsystem that has anything, in the model's order, with its state, word, value and sub`, () => {
      const status = at(name);
      const configured = status.subsystems.filter((s) => s.counts.total > 0);
      expect(configured.length).toBeGreaterThan(0);
      // The model's own two lines (#541), as they are.
      expect(subsystemCells(status)).toEqual(
        configured.map((s) => ({
          key: s.id,
          label: s.name,
          state: s.state,
          word: modelWord(status, s),
          value: s.value,
          sub: s.sub || undefined,
        }))
      );
    });
  }

  it('an older server, with no value or sub: the detail is the value, with no sub (#541)', () => {
    const status = structuredClone(at('incident'));
    for (const s of status.subsystems) {
      delete s.value;
      delete s.sub;
    }
    const cells = subsystemCells(status);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.value).toBe(status.subsystems.find((s) => s.id === c.key).detail);
      expect(c.sub).toBeUndefined();
    }
  });

  it('leaves out a subsystem with nothing in it, and has no cell on an empty board', () => {
    const healthy = at('healthy');
    const none = healthy.subsystems.filter((s) => s.counts.total === 0).map((s) => s.id);
    expect(none.length).toBeGreaterThan(0);
    for (const id of none) {
      expect(subsystemCells(healthy).map((c) => c.key)).not.toContain(id);
    }
    expect(subsystemCells(at('first-run'))).toEqual([]);
    expect(subsystemCells(null)).toEqual([]);
    expect(subsystemCells({ overall: {}, issues: [] })).toEqual([]);
  });

  it("names the filter by the model's subsystem, only one the strip shows", () => {
    const incident = at('incident');
    const nodes = incident.subsystems.find((s) => s.id === 'nodes');
    expect(subsystemFilter(incident, 'nodes')).toEqual({
      id: 'nodes',
      name: nodes.name,
      detail: nodes.detail,
    });
    const none = incident.subsystems.find((s) => s.counts.total === 0);
    expect(subsystemFilter(incident, none.id)).toBeNull();
    expect(subsystemFilter(incident, 'bogus')).toBeNull();
    expect(subsystemFilter(incident, null)).toBeNull();
    expect(subsystemFilter(null, 'nodes')).toBeNull();
  });
});
