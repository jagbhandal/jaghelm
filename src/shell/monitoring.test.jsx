/**
 * The Monitoring page (#751): its ranges, that every drawing is a chart of the
 * server's table (server/monitoring.js) and in its section, the hook that reads
 * the page's one request, and the page: placeholders before the first answer,
 * each chart's own failure sentence, and a read that fails as a whole.
 */
import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { DRAWINGS, MONITORING_RANGES, monitoringRangeOf } from './monitoring.js';
import { useMonitoring } from './useMonitoring.js';
import MonitoringPage from './MonitoringPage.jsx';
import { MONITORING_CHARTS } from '../../server/monitoring.js';
import { MONITORING_SECTIONS } from '../../server/monitoringSections.js';
import { demoMonitoring } from '../../server/demoFixtures.js';
import { UiRoot } from '@ui/root';
import { navGroups } from './nav.js';
import { NAV_HIDDEN } from '../router/routes.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');

let asked;
let answer;

beforeEach(() => {
  asked = [];
  answer = (range) => demoMonitoring({ query: { range }, now: NOW }).body;
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const u = new URL(String(url), 'http://x');
      asked.push(u.pathname + u.search);
      if (u.pathname !== '/api/monitoring') return Promise.reject(new Error(`unexpected ${url}`));
      const body = answer(u.searchParams.get('range'));
      if (body instanceof Error) return Promise.reject(body);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
      });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

/** A store like the status poll's `updated`, whose answers a test sends. */
function pollClock() {
  const listeners = new Set();
  return {
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    answer: () => act(() => listeners.forEach((fn) => fn())),
  };
}

describe('the tables', () => {
  it('has the drawer’s ranges and 30 days, each with the server’s step', () => {
    expect(MONITORING_RANGES.map((r) => [r.value, r.stepMs])).toEqual([
      ['1h', 60_000],
      ['24h', 300_000],
      ['7d', 1_800_000],
      ['30d', 7_200_000],
    ]);
    expect(monitoringRangeOf('nope').value).toBe('1h');
  });

  it('every drawing is a chart of the server’s table, in the section it names', () => {
    for (const [id, drawing] of Object.entries(DRAWINGS)) {
      expect(MONITORING_CHARTS[id]?.section, id).toBe(drawing.section);
    }
    expect(MONITORING_SECTIONS.map((s) => s.title)).toEqual([
      'Power and cost',
      'Capacity',
      'Resources',
      'Containers',
      'Drives',
    ]);
  });

  it('every chart of the table has a drawing', () => {
    expect(Object.keys(DRAWINGS).sort()).toEqual(Object.keys(MONITORING_CHARTS).sort());
  });
});

describe('while the route is hidden (routes.js)', () => {
  it('the sidebar leaves Monitoring out, and lists it after Infrastructure once shown', () => {
    const items = () =>
      navGroups({ routeId: 'overview', apps: [], loaded: new Set(), onUnload() {}, badge: null })
        .find((g) => g.id === 'monitor')
        .items.map((i) => i.id);
    expect(NAV_HIDDEN.has('monitoring')).toBe(true);
    expect(items()).toEqual(['overview', 'services', 'infrastructure', 'alerts']);
    NAV_HIDDEN.delete('monitoring');
    try {
      expect(items()).toEqual(['overview', 'services', 'infrastructure', 'monitoring', 'alerts']);
    } finally {
      NAV_HIDDEN.add('monitoring');
    }
  });
});

describe('useMonitoring', () => {
  it('sends a range and nothing else, once as it opens', async () => {
    const { result } = renderHook(() => useMonitoring('1h', null), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.body).not.toBeNull());
    expect(new Set(asked)).toEqual(new Set(['/api/monitoring?range=1h']));
    expect(result.current).toMatchObject({ range: '1h', error: null, busy: false });
  });

  it('reads on the status poll only once the range’s step has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const poll = pollClock();
      const { result } = renderHook(() => useMonitoring('1h', poll));
      await vi.waitFor(() => expect(result.current.body).not.toBeNull());
      const first = asked.length;
      vi.setSystemTime(Date.now() + 30_000);
      await poll.answer();
      expect(asked.length).toBe(first);
      vi.setSystemTime(Date.now() + 31_000);
      await poll.answer();
      await vi.waitFor(() => expect(asked.length).toBe(first + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the last answer drawn, busy, while a switched range is read', async () => {
    const { result, rerender } = renderHook(({ range }) => useMonitoring(range, null), {
      initialProps: { range: '1h' },
    });
    await waitFor(() => expect(result.current.body).not.toBeNull());
    const hour = result.current.body;
    // Hold the 24 h read until the test lets it go.
    let release;
    const held = new Promise((r) => (release = r));
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => (String(url).includes('range=24h') ? held.then(() => real(url)) : real(url)))
    );
    rerender({ range: '24h' });
    expect(result.current).toMatchObject({ body: hour, range: '1h', busy: true });
    release();
    await waitFor(() => expect(result.current.range).toBe('24h'));
    expect(result.current.busy).toBe(false);
    expect(result.current.body).not.toBe(hour);
  });

  it('a failed read keeps the last answer and says why; the next poll tries again', async () => {
    const poll = pollClock();
    const { result } = renderHook(() => useMonitoring('1h', poll));
    await waitFor(() => expect(result.current.body).not.toBeNull());
    answer = () => new Error('Network down');
    await poll.answer();
    // Only a step old: no read yet.
    expect(result.current.error).toBeNull();
    // A fresh hook that fails on its first read tries again on the next poll, whatever the step.
    const second = renderHook(() => useMonitoring('7d', poll));
    await waitFor(() => expect(second.result.current.error).toBe('Network down'));
    expect(second.result.current.body).toBeNull();
    const before = asked.length;
    answer = (range) => demoMonitoring({ query: { range }, now: NOW }).body;
    await poll.answer();
    await waitFor(() => expect(second.result.current.body).not.toBeNull());
    expect(second.result.current.error).toBeNull();
    expect(asked.length).toBeGreaterThan(before);
  });

  it('an answer that is not the page’s is a failed read', async () => {
    answer = () => ({ hello: 'world' });
    const { result } = renderHook(() => useMonitoring('1h', null));
    await waitFor(() => expect(result.current.error).toBe('Not an answer of /api/monitoring'));
    expect(result.current.body).toBeNull();
  });
});

describe('MonitoringPage', () => {
  const page = (updated = null) =>
    render(
      <UiRoot>
        <MonitoringPage updated={updated} />
      </UiRoot>
    );

  it('shows a placeholder under each heading it will draw before the first answer, announced once', async () => {
    // The read never answers.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    page();
    const section = screen.getByRole('region', { name: 'Resources' });
    expect(within(section).getByText('Loading Resources')).toBeInTheDocument();
    expect(section).toHaveAttribute('aria-busy', 'true');
    // Sections with no chart yet are not drawn.
    expect(screen.queryByRole('region', { name: 'Drives' })).toBeNull();
  });

  it('draws each chart under its question, with the range switch named', async () => {
    page();
    const section = await screen.findByRole('region', { name: 'Resources' });
    await waitFor(() => expect(within(section).getByRole('heading', { name: 'CPU by node' })).toBeInTheDocument());
    expect(within(section).getByText("Is a node's CPU off?")).toBeInTheDocument();
    expect(within(section).getByRole('img', { name: /CPU by node, last hour/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Monitoring' })).toBeInTheDocument();
  });

  it('a chart Prometheus could not answer says its own sentence and draws no line', async () => {
    answer = (range) => {
      const body = demoMonitoring({ query: { range }, now: NOW }).body;
      return {
        ...body,
        charts: body.charts.map((c) => ({
          id: c.id,
          title: c.title,
          question: c.question,
          section: c.section,
          ok: false,
          error: 'Prometheus refused the CPU query (HTTP 400)',
        })),
      };
    };
    page();
    expect(await screen.findByText('Prometheus refused the CPU query (HTTP 400)')).toBeInTheDocument();
    const card = document.querySelector('[data-chart="cpu-overview"]');
    expect(card.querySelector('svg path')).toBeNull();
  });

  it('a read that fails as a whole says so, with no placeholder left spinning', async () => {
    answer = () => new Error('Network down');
    page();
    expect(await screen.findByText("The charts couldn't be read (Network down).")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="monitoring-skeleton"]')).toBeNull();
  });

  it('switching the range asks the server for that range alone', async () => {
    page();
    await screen.findByRole('region', { name: 'Resources' });
    await waitFor(() => expect(asked).toContain('/api/monitoring?range=1h'));
    fireEvent.click(screen.getByRole('radio', { name: '30 d' }));
    await waitFor(() => expect(asked).toContain('/api/monitoring?range=30d'));
    expect(asked.every((a) => /^\/api\/monitoring\?range=(1h|30d)$/.test(a))).toBe(true);
  });
});
