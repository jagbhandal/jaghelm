/**
 * #314: how the Alerts pages read their filters and word the history. Pure:
 * the filters as the address keeps them, which active issues they leave, the
 * query History asks /api/events, and each event as a row (what, where, the
 * change, why, when, and whether the phones got it), grouped by day.
 */
import { describe, it, expect } from 'vitest';
import {
  NO_FILTERS,
  restates,
  alertFiltersSearch,
  changeOf,
  deliveryText,
  eventsQuery,
  filterSummary,
  hasFilters,
  historyDays,
  historyRow,
  issueMatches,
  readAlertFilters,
} from './alertsView.js';
import { demoEvents } from '../../server/demoEvents.js';
import { demoStatus } from '../../server/demoFixtures.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const STATUS = demoStatus({ scenario: 'incident', now: NOW });
const ENTITIES = new Map(STATUS.entities.map((e) => [e.id, e]));
const EVENTS = demoEvents({ scenario: 'incident', now: NOW }).events.slice().reverse();
const byType = (type) => EVENTS.find((e) => e.type === type);

describe('the filters in the address', () => {
  it('reads severity, kind and the search, and drops what it does not know', () => {
    expect(readAlertFilters('')).toEqual(NO_FILTERS);
    expect(readAlertFilters('?severity=critical&kind=services&q=jelly')).toEqual({
      severity: 'critical',
      kind: 'services',
      q: 'jelly',
    });
    expect(readAlertFilters('?severity=loud&kind=service&q=%20%20')).toEqual(NO_FILTERS);
    expect(readAlertFilters('?q=%20jelly%20&entity=services/apps:jellyfin')).toEqual({
      ...NO_FILTERS,
      q: 'jelly',
    });
    expect(readAlertFilters(`?q=${'x'.repeat(150)}`).q).toHaveLength(100);
  });

  it('writes them after the query it keeps (an open entity stays, its id as written), and none when cleared', () => {
    expect(alertFiltersSearch({ severity: 'warning', kind: 'nodes', q: 'pve 1' }, '')).toBe(
      '?severity=warning&kind=nodes&q=pve+1'
    );
    expect(alertFiltersSearch(NO_FILTERS, '?severity=warning&kind=nodes')).toBe('');
    expect(
      alertFiltersSearch({ ...NO_FILTERS, kind: 'power' }, '?entity=power/ups&severity=info')
    ).toBe('?entity=power/ups&kind=power');
    // The list pages' one writer (#313): an id's `/` and `:` stay as they are.
    expect(
      alertFiltersSearch(
        { ...NO_FILTERS, severity: 'critical' },
        '?entity=services/apps:jellyfin&q=old'
      )
    ).toBe('?entity=services/apps:jellyfin&severity=critical');
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, q: 'x' })).toBe(true);
  });

  it('says what they show in words, for the panel and the empty lines', () => {
    expect(filterSummary(NO_FILTERS)).toBeNull();
    expect(filterSummary({ ...NO_FILTERS, severity: 'critical' })).toBe('critical alerts');
    expect(filterSummary({ ...NO_FILTERS, kind: 'sources' })).toBe('alerts on monitoring sources');
    expect(filterSummary({ severity: 'info', kind: 'nodes', q: 'pve' })).toBe(
      'info alerts on nodes matching “pve”'
    );
  });

  it('asks /api/events only for what is set', () => {
    expect(eventsQuery(NO_FILTERS)).toEqual({});
    expect(eventsQuery({ severity: 'warning', kind: 'jobs', q: 'dump' })).toEqual({
      severity: 'warning',
      kind: 'jobs',
      q: 'dump',
    });
  });
});

describe('which active issues the filters leave', () => {
  const [jellyfin, backup] = STATUS.issues;

  it('severity: critical is crit, warning is warn; info is never an active issue', () => {
    expect(issueMatches(jellyfin, { ...NO_FILTERS, severity: 'critical' })).toBe(true);
    expect(issueMatches(jellyfin, { ...NO_FILTERS, severity: 'warning' })).toBe(false);
    expect(
      issueMatches({ ...jellyfin, state: 'warn' }, { ...NO_FILTERS, severity: 'warning' })
    ).toBe(true);
    expect(issueMatches(jellyfin, { ...NO_FILTERS, severity: 'info' })).toBe(false);
    // No signal is no severity: it shows only unfiltered by one.
    expect(issueMatches({ ...jellyfin, state: 'unknown' }, NO_FILTERS)).toBe(true);
    expect(
      issueMatches({ ...jellyfin, state: 'unknown' }, { ...NO_FILTERS, severity: 'critical' })
    ).toBe(false);
  });

  it('kind: the subsystem the issue is in', () => {
    expect(issueMatches(jellyfin, { ...NO_FILTERS, kind: 'services' })).toBe(true);
    expect(issueMatches(backup, { ...NO_FILTERS, kind: 'services' })).toBe(false);
    expect(issueMatches(backup, { ...NO_FILTERS, kind: 'backups' })).toBe(true);
  });

  it('search: any case, in the name, where, the word, the reason or the id', () => {
    for (const q of ['JELLY', 'service · apps', 'down', 'kuma:', 'services/apps']) {
      expect(issueMatches(jellyfin, { ...NO_FILTERS, q }), q).toBe(true);
    }
    expect(issueMatches(backup, { ...NO_FILTERS, q: 'locked' })).toBe(true);
    expect(issueMatches(backup, { ...NO_FILTERS, q: 'jelly' })).toBe(false);
  });
});

describe('an event as a history row', () => {
  it('a service going down: its name and where from the model, the change, why, when, the phones', () => {
    const down = EVENTS.find((e) => e.entity === 'services/apps:jellyfin');
    expect(historyRow(down, ENTITIES)).toEqual({
      id: down.id,
      entity: 'services/apps:jellyfin',
      state: 'crit',
      name: 'Jellyfin',
      where: 'Service · apps',
      change: 'Down',
      reason: 'Kuma: down',
      at: Date.parse(down.at),
      time: expect.stringMatching(/^\d\d:\d\d$/),
      delivery: 'Sent to 2 phones',
      reached: true,
      gone: false,
    });
  });

  it('a recovery says the change from and to, and is drawn ok', () => {
    const up = historyRow(byType('service_recovered'), ENTITIES);
    expect([up.state, up.name, up.change, up.reason]).toEqual([
      'ok',
      'Gitea',
      'Down → Up',
      'Kuma: up',
    ]);
    expect(historyRow(byType('ups_restored'), ENTITIES).change).toBe('On battery → On mains');
  });

  it('a removed entity keeps the name its event said, where from its id, and says it is gone', () => {
    const plex = historyRow(
      EVENTS.find((e) => e.entity === 'services/apps:plex'),
      ENTITIES
    );
    expect([plex.name, plex.where, plex.gone, plex.delivery]).toEqual([
      'Plex',
      'Service · apps',
      true,
      'Push not set up',
    ]);
    // Without a status yet, nothing is called gone.
    expect(historyRow(EVENTS[0], null).gone).toBe(false);
    expect(
      historyRow(
        EVENTS.find((e) => e.entity === 'services/apps:plex'),
        null
      ).name
    ).toBe('Plex');
  });

  it("a source's recovery names it; it isn't gone, the model lists a source only while it fails", () => {
    const back = historyRow(byType('source_recovered'), ENTITIES);
    expect([back.name, back.where, back.change, back.reason, back.gone]).toEqual([
      'Prometheus',
      'Monitoring source',
      'Down → Up',
      null,
      false,
    ]);
  });

  it('an event with no name in its words says its title, and its words as the reason', () => {
    const notice = historyRow(
      {
        ...byType('source_down'),
        type: 'arcane_update',
        severity: 'info',
        entity: null,
        title: 'Updates · apps',
        body: '3 updated: immich, nextcloud, wikijs',
        reason: null,
      },
      ENTITIES
    );
    expect([notice.name, notice.where, notice.change, notice.reason]).toEqual([
      'Updates · apps',
      undefined,
      null,
      '3 updated: immich, nextcloud, wikijs',
    ]);
    const check = historyRow(
      {
        ...byType('source_down'),
        entity: null,
        key: 'status',
        title: 'JagHelm status check failing',
        body: "JagHelm can't work out the status.",
        reason: null,
        severity: 'critical',
      },
      ENTITIES
    );
    expect([check.entity, check.name, check.where, check.reason, check.gone]).toEqual([
      null,
      'JagHelm status check failing',
      undefined,
      "JagHelm can't work out the status.",
      false,
    ]);
  });

  it('a reading names its node, its level the change', () => {
    const disk = historyRow(byType('host_threshold'), ENTITIES);
    expect([disk.state, disk.name, disk.where, disk.change]).toEqual([
      'warn',
      'Storage',
      'Node · storage',
      'Warning',
    ]);
    expect(changeOf({ type: 'host_threshold', severity: 'critical' })).toBe('Critical');
    expect(changeOf({ type: 'host_threshold_cleared', severity: 'info' })).toBe('Normal');
    expect(changeOf({ type: 'arcane_update', severity: 'info' })).toBeNull();
  });

  it('leaves out a reason that only says the change again; keeps one with evidence of its own', () => {
    // [change, reason, state, left out]
    const TABLE = [
      ['On battery → On mains', 'On mains', 'ok', true],
      ['Normal', 'Healthy', 'ok', true],
      ['Unreachable → Reachable', 'Healthy', 'ok', true],
      ['Down → Up', 'Up', 'ok', true],
      ['Down → Up', 'Kuma: up', 'ok', false],
      ['On battery', 'On battery (88 % charge)', 'crit', false],
      ['OK', 'Last run succeeded', 'ok', false],
      ['Down', 'Kuma: down', 'crit', false],
      ['Warning', 'Healthy', 'warn', false],
      [null, 'Healthy', 'ok', false],
      ['Down', null, 'crit', false],
    ];
    for (const [change, reason, state, out] of TABLE) {
      expect(restates(reason, change, state), `${change} · ${reason}`).toBe(out);
    }
    // Through the rows the demo's history makes.
    expect(historyRow(byType('ups_restored'), ENTITIES).reason).toBeNull();
    expect(historyRow(byType('host_threshold_cleared'), ENTITIES).reason).toBeNull();
    expect(historyRow(byType('host_recovered'), ENTITIES).reason).toBeNull();
    expect(historyRow(byType('ups_on_battery'), ENTITIES).reason).toBe('On battery (88 % charge)');
    expect(historyRow(byType('service_recovered'), ENTITIES).reason).toBe('Kuma: up');
    expect(historyRow(byType('cron_recovered'), ENTITIES).reason).toBe('Last run succeeded');
  });

  it('says what push did with it', () => {
    const push = (state, phones = 0, suppressed = 0) => ({ state, phones, suppressed });
    expect(deliveryText(push('sent', 1))).toBe('Sent to 1 phone');
    expect(deliveryText(push('sent', 3, 1))).toBe('Sent to 3 phones');
    expect(deliveryText(push('queued'))).toBe('Sending');
    expect(deliveryText(push('off'))).toBe('Push not set up');
    expect(deliveryText(push('suppressed', 0, 2))).toBe('Not sent: off in phone settings');
    expect(deliveryText(push('unsent'))).toBe('Not sent');
    expect(deliveryText(push('dropped'))).toBe('Not sent: dropped');
    expect(deliveryText(undefined)).toBeNull();
  });
});

describe('history by day', () => {
  it('groups the rows by the day they happened, newest first, as Today, Yesterday or the date', () => {
    const rows = EVENTS.map((e) => historyRow(e, ENTITIES));
    const days = historyDays(rows, NOW);
    expect(days[0].label).toBe('Today');
    expect(days[0].rows.map((r) => r.name)).toContain('Jellyfin');
    expect(days.some((d) => d.label === 'Yesterday' || d.label === 'Today')).toBe(true);
    expect(days.flatMap((d) => d.rows)).toEqual(rows);
    expect(days.at(-1).label).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});
