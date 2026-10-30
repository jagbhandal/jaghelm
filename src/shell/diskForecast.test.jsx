/*
 * The disk forecast on the nodes (#670): which note a forecast draws and in
 * what state, that the number only follows the server's days, and the note
 * under a node's disk meter on the Infrastructure section's nodes, the
 * detail screen's and the table.
 */
import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  FORECAST_POLL_MS,
  MAX_NOTE_DAYS,
  daysLeftText,
  forecastLinesOf,
  forecastNote,
  forecastState,
  useDiskForecast,
} from './diskForecast.js';
import { infrastructureNodes } from './infrastructureView.js';
import { InfrastructureSection } from '@ui/infrastructure-section';
import { demoBoard } from '../testing/statusFixtures.js';
import { DISK_FORECAST_DEFAULT } from '../../server/diskForecastLines.js';

const NOW = Date.parse('2026-10-20T09:00:00Z');
const LINES = { warn: 14, crit: 3 };
const ok = (daysLeft, extra = {}) => ({
  status: 'ok',
  daysLeft,
  mount: '/',
  primary: true,
  ...extra,
});

describe('the note a forecast draws', () => {
  it('amber under the warn line, red under the crit line, plain above', () => {
    expect(forecastState(40, LINES)).toBe('ok');
    expect(forecastState(14, LINES)).toBe('ok');
    expect(forecastState(13.9, LINES)).toBe('warn');
    expect(forecastState(3, LINES)).toBe('warn');
    expect(forecastState(2.9, LINES)).toBe('crit');
    expect(forecastNote(ok(40), LINES)).toMatchObject({ state: 'ok', text: '40 days left' });
    expect(forecastNote(ok(9.6), LINES)).toMatchObject({ state: 'warn', text: '9 days left' });
    expect(forecastNote(ok(2.4), LINES)).toMatchObject({ state: 'crit', text: '2 days left' });
  });

  it('says it in words as well as colour, once past a line', () => {
    expect(forecastNote(ok(40), LINES).said).toBe('Disk forecast: 40 days left');
    expect(forecastNote(ok(9.6), LINES).said).toBe('Disk forecast: 9 days left, warning');
    expect(forecastNote(ok(2.4), LINES).said).toBe('Disk forecast: 2 days left, critical');
  });

  it('the lines are the ones given: changing them changes the state of the same days', () => {
    expect(forecastNote(ok(20), { warn: 14, crit: 3 }).state).toBe('ok');
    expect(forecastNote(ok(20), { warn: 30, crit: 3 }).state).toBe('warn');
    expect(forecastNote(ok(20), { warn: 30, crit: 25 }).state).toBe('crit');
  });

  it('words: one day, under a day, and the mount when it is not the meter’s', () => {
    expect(daysLeftText(1.9)).toBe('1 day left');
    expect(daysLeftText(0.4)).toBe('Under 1 day left');
    expect(forecastNote(ok(5, { mount: '/data', primary: false }), LINES).text).toBe(
      '/data: 5 days left'
    );
  });

  it('names the size of a mount the meter does not show (#797)', () => {
    expect(forecastNote(ok(38, { mount: '/ugreen', primary: false, sizeBytes: 4.19e9 }), LINES).text).toBe(
      '/ugreen, 4.2 GB: 38 days left'
    );
  });

  it('draws nothing for a number further off than 90 days', () => {
    expect(MAX_NOTE_DAYS).toBe(90);
    expect(forecastNote(ok(90), LINES)).toMatchObject({ text: '90 days left' });
    expect(forecastNote(ok(90.5), LINES)).toBeNull();
    expect(forecastNote(ok(145), LINES, { stale: true })).toBeNull();
  });

  it('draws nothing for a disk that is stable, noisy or has too little history', () => {
    for (const status of ['stable', 'noisy', 'insufficient']) {
      expect(forecastNote({ status, daysLeft: null }, LINES)).toBeNull();
    }
    expect(forecastNote(undefined, LINES)).toBeNull();
  });

  it('a node with no current readings, or a stale board, is No signal, never a number', () => {
    expect(forecastNote({ status: 'nodata', daysLeft: null }, LINES)).toMatchObject({
      state: 'unknown',
      text: 'No signal',
    });
    expect(forecastNote(ok(2), LINES, { stale: true })).toMatchObject({
      state: 'unknown',
      text: 'No signal',
    });
    expect(forecastNote(ok(2), LINES, { unread: true })).toMatchObject({
      state: 'unknown',
      text: 'No signal',
    });
    // Stale with nothing to forecast says nothing.
    expect(forecastNote({ status: 'stable' }, LINES, { stale: true })).toBeNull();
  });

  it('the saved lines are used when they make a pair, the defaults otherwise', () => {
    expect(forecastLinesOf({})).toEqual(DISK_FORECAST_DEFAULT);
    expect(forecastLinesOf({ diskForecastDays: { warn: 30, crit: 7 } })).toEqual({
      warn: 30,
      crit: 7,
    });
    for (const bad of [{ warn: 3, crit: 14 }, { warn: 14 }, { warn: 14.5, crit: 3 }, 'x', null]) {
      expect(forecastLinesOf({ diskForecastDays: bad })).toEqual(DISK_FORECAST_DEFAULT);
    }
  });
});

describe('under a node’s disk meter', () => {
  const board = demoBoard({ scenario: 'healthy', now: NOW });
  const key = board.status.entities.find((e) => e.kind === 'node').node;
  const disk = (nodes) => nodes.find((n) => n.key === key).readings.find((r) => r.key === 'disk');

  it('the disk reading carries the note, and no other reading does', () => {
    const forecast = { nodes: { [key]: ok(9.6) }, lines: LINES };
    const nodes = infrastructureNodes({ status: board.status, services: board.services, forecast });
    expect(disk(nodes).note).toMatchObject({ state: 'warn', text: '9 days left' });
    for (const n of nodes) {
      for (const r of n.readings.filter((x) => x.key !== 'disk')) expect(r.note).toBeUndefined();
    }
  });

  it('without a forecast, or for a node it lacks, there is no note', () => {
    expect(
      disk(infrastructureNodes({ status: board.status, services: board.services })).note
    ).toBeUndefined();
    const other = infrastructureNodes({
      status: board.status,
      services: board.services,
      forecast: { nodes: { elsewhere: ok(2) }, lines: LINES },
    });
    expect(disk(other).note).toBeUndefined();
  });

  it('a stale board turns the number into No signal', () => {
    const nodes = infrastructureNodes({
      status: board.status,
      services: board.services,
      freshness: { stale: true },
      forecast: { nodes: { [key]: ok(2) }, lines: LINES },
    });
    expect(disk(nodes).note).toMatchObject({ state: 'unknown', text: 'No signal' });
  });

  it('cards and table both draw it, with an icon and the words', () => {
    const forecast = { nodes: { [key]: ok(2.4) }, lines: LINES };
    const nodes = infrastructureNodes({
      status: board.status,
      services: board.services,
      forecast,
    }).map((n) => ({
      ...n,
      href: undefined,
    }));
    for (const view of ['cards', 'table']) {
      const { unmount } = render(<InfrastructureSection nodes={nodes} view={view} />);
      const notes = document.querySelectorAll('[data-slot="meter-note"]');
      expect(notes).toHaveLength(1);
      expect(notes[0]).toHaveAttribute('data-state', 'crit');
      expect(notes[0].querySelector('svg')).not.toBeNull();
      expect(
        within(notes[0]).getByText('Disk forecast: 2 days left, critical')
      ).toBeInTheDocument();
      expect(screen.getAllByText('2 days left').length).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('reading /api/disk-forecast', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });
  const serve = (body) => {
    const fetch = vi.fn(async () =>
      Response.json(body, { headers: { ETag: `"${Math.random()}"` } })
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  const asked = (fetch) =>
    fetch.mock.calls.filter(([u]) => String(u).endsWith('/api/disk-forecast')).length;

  it('gives the answer’s nodes; a failed read (ok:false) gives none, so no node is told No signal for it', async () => {
    serve({ ok: false, error: 'Prometheus refused the connection', nodes: {} });
    const { result, unmount } = renderHook(() => useDiskForecast());
    await act(async () => {});
    expect(result.current).toEqual({});
    unmount();
    serve({ ok: true, nodes: { pve: ok(5) } });
    const good = renderHook(() => useDiskForecast());
    await act(async () => {});
    expect(good.result.current.pve.daysLeft).toBe(5);
  });

  it('a failed read (ok:false) never replaces a good answer already held', async () => {
    vi.useFakeTimers();
    let body = { ok: true, nodes: { pve: ok(5) } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(body, { headers: { ETag: `"${Math.random()}"` } }))
    );
    const { result } = renderHook(() => useDiskForecast());
    await act(async () => {});
    expect(result.current.pve.daysLeft).toBe(5);
    body = { ok: false, error: 'Prometheus refused the connection', nodes: {} };
    await act(async () => vi.advanceTimersByTimeAsync(FORECAST_POLL_MS + 61_000));
    expect(result.current.pve.daysLeft).toBe(5);
  });

  it('turning active back on within the half hour reads nothing', async () => {
    const fetch = serve({ ok: true, nodes: {} });
    const { rerender } = renderHook(({ active }) => useDiskForecast({ active }), {
      initialProps: { active: true },
    });
    await act(async () => {});
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    expect(asked(fetch)).toBe(1);
  });

  it('asks on load and then only every half hour, never while the tab is hidden, and not when inactive', async () => {
    vi.useFakeTimers();
    const fetch = serve({ ok: true, nodes: {} });
    const idle = renderHook(() => useDiskForecast({ active: false }));
    await act(async () => {});
    expect(asked(fetch)).toBe(0);
    idle.unmount();

    renderHook(() => useDiskForecast());
    await act(async () => {});
    expect(asked(fetch)).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(FORECAST_POLL_MS - 120_000));
    expect(asked(fetch)).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await act(async () => vi.advanceTimersByTimeAsync(FORECAST_POLL_MS));
    expect(asked(fetch)).toBe(1);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {});
    expect(asked(fetch)).toBe(2);
  });
});
