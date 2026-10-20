import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import App from './App.jsx';

// Request counter for the dashboard's polling (#237). A URL-aware fetch stub
// records every request path; fake timers step the 30 s refresh tick, so each
// test can count what one tick (or a stretch of hidden time) costs.

const DASHBOARD_SOURCES = [
  '/api/services',
  '/api/ups',
  '/api/integrations',
  '/api/history',
  '/api/cron/status',
  '/api/gitea/activity',
];
const TICK_MS = 30_000;

let requests;
let health;
let nodes;
let failing; // paths the stub answers with HTTP 503

function respond(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function stubServer() {
  requests = [];
  health = 'up';
  nodes = {};
  failing = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const path = String(url).split('?')[0];
      requests.push(path);
      if (failing.has(path))
        return Promise.resolve({ ok: false, status: 503, headers: { get: () => null } });
      if (path === '/api/auth/check') return respond({ authRequired: false, authenticated: true });
      if (path === '/api/services') return respond({ nodes, overallHealth: health });
      if (path === '/api/weather')
        return respond({ current: { temperature_2m: 60, weather_code: 0 } });
      if (['/api/todos', '/api/gitea/activity', '/api/cron/status'].includes(path))
        return respond([]);
      return respond({});
    })
  );
}

// Step fake time, flushing the fetch promises that resolve along the way.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Requests made since the last call, emptying the log.
const take = () => requests.splice(0);
const count = (list, path) => list.filter((p) => p === path).length;
const healthLabel = () => document.querySelector('.nav-health-label');
const updatedLabel = () => document.querySelector('.nav-updated');

function setHidden(hidden) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

// Render the app and let the initial load settle. The refresh interval arms
// 500 ms after the dashboard mounts, so ticks land 30.5 s, 60.5 s, ... after it:
// stepping 1 s here and whole ticks afterwards puts exactly one tick in each step.
async function renderApp() {
  render(<App />);
  await vi.waitFor(() => expect(requests).toContain('/api/services'));
  await advance(1000);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  stubServer();
});

afterEach(() => {
  vi.useRealTimers();
  delete document.hidden;
  delete document.visibilityState;
});

describe('dashboard polling — request budget', () => {
  it('loads each dashboard source once (services once, not three times)', async () => {
    await renderApp();
    const load = take();
    for (const path of DASHBOARD_SOURCES) expect(count(load, path), path).toBe(1);
  });

  it('makes at most 4 requests per 30 s tick, with services fetched once per tick', async () => {
    await renderApp();
    take();
    const ticks = [];
    for (let i = 0; i < 6; i++) {
      await advance(TICK_MS);
      ticks.push(take());
    }
    for (const tick of ticks) {
      expect(tick.length).toBeLessThanOrEqual(4);
      expect(count(tick, '/api/services')).toBe(1);
    }
    // The slow sources still refresh, each in turn: twice in six ticks.
    const all = ticks.flat();
    for (const path of ['/api/history', '/api/cron/status', '/api/gitea/activity']) {
      expect(count(all, path), path).toBe(2);
    }
  });

  it('updates the header health dot on every tick from the dashboard fetch', async () => {
    await renderApp();
    expect(healthLabel()).toHaveTextContent('All Systems Operational');
    health = 'down';
    await advance(TICK_MS);
    expect(healthLabel()).toHaveTextContent('Service Disruption');
  });

  it('fetches weather on load and then every 10 minutes, not every tick', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ showWeather: true, weatherLat: '40', weatherLon: '-80', tabs: [] })
    );
    await renderApp();
    expect(count(take(), '/api/weather')).toBe(1);
    await advance(19 * TICK_MS); // 9.5 minutes
    expect(count(take(), '/api/weather')).toBe(0);
    await advance(TICK_MS); // the first tick past 10 minutes
    expect(count(take(), '/api/weather')).toBe(1);
  });
});

describe('dashboard polling — paused when nobody is looking', () => {
  it('makes no requests while the browser tab is hidden and refreshes at once on return', async () => {
    await renderApp();
    take();
    setHidden(true);
    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);

    health = 'down';
    setHidden(false);
    await advance(0);
    const back = take();
    for (const path of DASHBOARD_SOURCES) expect(count(back, path), path).toBe(1);
    expect(healthLabel()).toHaveTextContent('Service Disruption');
  });

  it('makes no requests on the Settings tab and refreshes at once back on the dashboard', async () => {
    await renderApp();
    take();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await vi.waitFor(() => screen.getByRole('navigation', { name: 'Settings sections' }));
    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);

    health = 'down';
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    await advance(0);
    const back = take();
    for (const path of DASHBOARD_SOURCES) expect(count(back, path), path).toBe(1);
    expect(healthLabel()).toHaveTextContent('Service Disruption');
  });

  it('restarts the "Updated" clock on return', async () => {
    await renderApp();
    setHidden(true);
    await advance(5 * TICK_MS);
    expect(updatedLabel()).toHaveTextContent('Updated 2m ago');

    setHidden(false);
    await advance(0);
    expect(updatedLabel()).toHaveTextContent('Updated just now');
  });

  it('loads the Settings live preview once when shown, and never polls it', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await vi.waitFor(() => screen.getByRole('button', { name: /show preview/i }));
    take();
    fireEvent.click(screen.getByRole('button', { name: /show preview/i }));
    await advance(0);
    const shown = take();
    for (const path of DASHBOARD_SOURCES) expect(count(shown, path), path).toBe(1);
    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);
  });

  it('makes no requests on an iframe tab and refreshes at once back on the dashboard', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({
        tabs: [{ id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' }],
      })
    );
    await renderApp();
    take();
    fireEvent.click(screen.getByRole('tab', { name: 'Grafana' }));
    await vi.waitFor(() => document.querySelector('iframe'));
    await advance(5 * TICK_MS);
    // The dashboard asks nothing. Opening the app asks once whether its headers
    // let it be framed (#269).
    expect(take()).toEqual(['/api/embed-check/grafana']);

    fireEvent.click(screen.getByRole('tab', { name: 'Dashboard' }));
    await advance(0);
    const back = take();
    for (const path of DASHBOARD_SOURCES) expect(count(back, path), path).toBe(1);
  });
});

describe('dashboard polling — stale notes', () => {
  // The cron panel's error banner; the page-level live region repeats its text.
  const cronBanner = () =>
    [...document.querySelectorAll('.degraded-banner')].find((b) =>
      /Job history unavailable/.test(b.textContent)
    );
  // One tick per act(), so React renders each tick (one act batches them all).
  const ticks = async (n) => {
    for (let i = 0; i < n; i++) await advance(TICK_MS);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags the cron panel stale after 2 missed cron polls (3 minutes), not 1 minute', async () => {
    // A node and a measurable width, so the grid (and its cron panel) renders.
    nodes = { pve: { display_name: 'PVE', services: [] } };
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1280);
    await renderApp(); // cron last succeeded at load
    failing.add('/api/cron/status');

    // ~2.5 minutes on: cron has failed twice (it polls every third tick), and is
    // past a 1-minute threshold but inside its own 3-minute one.
    await ticks(5);
    expect(cronBanner()).toBeTruthy();
    expect(cronBanner().querySelector('.degraded-banner-stale')).toBeNull();

    // ~3.5 minutes on: past 2 cron poll periods.
    await ticks(2);
    expect(cronBanner()).toHaveTextContent('updated 3m ago');
  });
});
