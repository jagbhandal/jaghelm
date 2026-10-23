import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import App from './App.jsx';
import { RAIL_WIDTH } from '@ui/app-shell';
import { HEALTHY, INCIDENT } from './testing/statusFixtures.js';

// Request counter for the Overview's polling (#237), the header's status poll
// (#296) and the request budget (#306, spec §4): at most 4 requests a tab
// makes per 30 s tick, the rail's Pipeline counted, none while hidden. A
// URL-aware fetch stub records every request path; fake timers step the 30 s
// refresh tick, so each test can count what one tick (or a stretch of hidden
// time) costs.

// What the Overview reads beside the status (tickBudget.js); the old board's
// /api/ups and /api/cron/status went with it (#306).
const DASHBOARD_SOURCES = ['/api/services', '/api/integrations', '/api/history'];
// The utilities rail's Pipeline, from 1440px (#301).
const PIPELINE = '/api/gitea/activity';
const TICK_MS = 30_000;

let requests;
let status; // what /api/status answers
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
  status = HEALTHY;
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
      if (path === '/api/services') return respond({ nodes, overallHealth: 'up' });
      if (path === '/api/status') return respond(status);
      if (['/api/todos', '/api/gitea/activity'].includes(path)) return respond([]);
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
// What the board asks for, leaving out the header's status poll and the
// rail's to-dos (read once, as the rail mounts).
const board = (list) => list.filter((p) => p !== '/api/status' && p !== '/api/todos');
const headerStatus = () =>
  within(screen.getByRole('banner')).getByRole('link', { name: /^(Critical|All systems)/ });
const updatedLabel = () => within(screen.getByRole('banner')).getByText(/^Updated/);
const entry = (name) =>
  within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', {
    name: new RegExp(`^${name}(,|$)`),
  });

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

/** A window from 1440px (the rail's width) or narrower. */
function wide(on) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: on && query === RAIL_WIDTH,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
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
  afterEach(() => vi.restoreAllMocks());

  it('loads each source once (services once, not three times), and the status once', async () => {
    await renderApp();
    const load = take();
    for (const path of [...DASHBOARD_SOURCES, '/api/status']) {
      expect(count(load, path), path).toBe(1);
    }
    // What the old board read for its panels is never asked (#306).
    for (const path of ['/api/ups', '/api/cron/status']) expect(count(load, path), path).toBe(0);
  });

  // Spec §4 (#306): at most 4 requests per 30 s tick per tab, the rail's
  // Pipeline counted: the status, services and integrations every tick, and
  // history or the Pipeline in turn, never both (tickBudget.js).
  for (const [where, rail] of [
    ['from 1440px, with the rail', true],
    ['narrower, no rail', false],
  ]) {
    it(`${where}: at most 4 requests per 30 s tick, the status and services once each`, async () => {
      wide(rail);
      await renderApp();
      take();
      const ticks = [];
      for (let i = 0; i < 6; i++) {
        await advance(TICK_MS);
        ticks.push(take());
      }
      for (const tick of ticks) {
        expect(tick.length, tick.join(', ')).toBeLessThanOrEqual(4);
        expect(count(tick, '/api/services')).toBe(1);
        expect(count(tick, '/api/integrations')).toBe(1);
        expect(count(tick, '/api/status')).toBe(1);
        expect(count(tick, '/api/history') + count(tick, PIPELINE)).toBeLessThanOrEqual(1);
      }
      // The slow ones still refresh, each once in three ticks.
      const all = ticks.flat();
      expect(count(all, '/api/history')).toBe(2);
      expect(count(all, PIPELINE)).toBe(rail ? 2 : 0);
    });
  }

  it('updates the header from /api/status on every tick', async () => {
    await renderApp();
    expect(headerStatus()).toHaveAccessibleName(`All systems normal: ${HEALTHY.overall.sentence}`);
    status = INCIDENT;
    await advance(TICK_MS);
    expect(headerStatus()).toHaveAccessibleName(`Critical: ${INCIDENT.overall.sentence}`);
  });
});

describe('dashboard polling — paused when nobody is looking', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks nothing at all while the browser tab is hidden, the rail’s Pipeline included, and refreshes at once on return', async () => {
    wide(true);
    await renderApp();
    take();
    setHidden(true);
    await advance(5 * TICK_MS);
    expect(take()).toEqual([]);

    status = INCIDENT;
    setHidden(false);
    await advance(0);
    const back = take();
    for (const path of [...DASHBOARD_SOURCES, '/api/status', PIPELINE]) {
      expect(count(back, path), path).toBe(1);
    }
    expect(headerStatus()).toHaveAccessibleName(`Critical: ${INCIDENT.overall.sentence}`);
  });

  it('the board asks nothing on Settings, the header only its status; the board refreshes at once back on the Overview', async () => {
    await renderApp();
    take();
    fireEvent.click(entry('Settings'));
    await vi.waitFor(() => screen.getByRole('navigation', { name: 'Settings sections' }));
    await advance(5 * TICK_MS);
    const away = take();
    expect(board(away)).toEqual([]);
    expect(count(away, '/api/status')).toBe(5);

    fireEvent.click(entry('Overview'));
    await advance(0);
    const back = take();
    for (const path of DASHBOARD_SOURCES) expect(count(back, path), path).toBe(1);
  });

  it('restarts the "Updated" clock on return', async () => {
    await renderApp();
    setHidden(true);
    await advance(5 * TICK_MS);
    expect(updatedLabel()).toHaveTextContent('Updated 2 min ago');

    setHidden(false);
    await advance(0);
    expect(updatedLabel()).toHaveTextContent('Updated just now');
  });

  it('the board asks nothing on an app and refreshes at once back on the Overview', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({
        tabs: [{ id: 'grafana', label: 'Grafana', type: 'iframe', url: 'https://grafana.example' }],
      })
    );
    await renderApp();
    take();
    fireEvent.click(entry('Grafana'));
    await vi.waitFor(() => document.querySelector('iframe'));
    await advance(5 * TICK_MS);
    // The dashboard asks nothing. (Opening the app may ask once whether its
    // headers let it be framed, #269; not here, as this server has no saved tab.)
    expect(board(take()).filter((p) => !p.startsWith('/api/embed-check/'))).toEqual([]);

    fireEvent.click(entry('Overview'));
    await advance(0);
    const back = take();
    for (const path of DASHBOARD_SOURCES) expect(count(back, path), path).toBe(1);
  });
});
