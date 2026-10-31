import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import App from './App.jsx';
import { RAIL_WIDTH } from '@ui/app-shell';
import { HEALTHY, INCIDENT } from './testing/statusFixtures.js';
import { refreshHints } from './pollSchedule.js';

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
// The pending host steps (#673): read on load and every 5 minutes on a clock of
// its own, outside the tick's budget (tickBudget.js).
const HOST_ACTIONS = '/api/host-actions';
// The Backups section (#675): the same, on a clock of its own.
const BACKUPS = '/api/backups';
// The config drift row (#674): the same, every 5 minutes on a clock of its own.
const DRIFT = '/api/drift';
// The Expiry section (#676): the same, on a clock of its own.
const EXPIRY = '/api/expiry';
const TICK_MS = 30_000;

let requests;
let status; // what /api/status answers
let nodes;
let failing; // paths the stub answers with HTTP 503
let monitoring; // what /api/monitoring answers
let hint; // X-Next-Refresh-Ms the stub sends on the status and services, or null

function respond(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: (name) => (hint && name === 'X-Next-Refresh-Ms' ? hint : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function stubServer() {
  requests = [];
  status = HEALTHY;
  nodes = {};
  failing = new Set();
  hint = null;
  monitoring = { range: '1h', charts: [] };
  refreshHints.clear();
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
      if (path === '/api/monitoring') return respond(monitoring);
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

// Requests made since the last call, emptying the log; `take` leaves out the
// pending host steps (#673), which keep a clock of their own: `takeAll` has them.
const takeAll = () => requests.splice(0);
const take = () => takeAll().filter((p) => p !== HOST_ACTIONS && p !== BACKUPS && p !== DRIFT && p !== EXPIRY);
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

  // #630: the tick and the status poll follow the server's hint.
  it('ticks and polls the status when the server says its cycle is done, within the budget', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    hint = '12000';
    await renderApp();
    take();
    await advance(10_000); // 11 s since the hint came
    expect(take()).toEqual([]); // not before it
    await advance(1_500);
    const tick = take();
    expect(count(tick, '/api/status')).toBe(1);
    expect(count(tick, '/api/services')).toBe(1);
    expect(tick.length).toBeLessThanOrEqual(4);
  });

  it('without a hint keeps the fixed interval', async () => {
    await renderApp();
    take();
    await advance(11_000);
    expect(take()).toEqual([]);
    await advance(TICK_MS);
    expect(count(take(), '/api/services')).toBe(1);
  });

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

  // #306: the rail's weather reads on the tick too, once its 10 minutes are
  // up, on a tick no other slow read takes: over 45 ticks (22.5 minutes at
  // 30 s) it reads twice, and no tick asks for more than 4.
  it('from 1440px with the weather on: at most 4 a tick, the weather on a tick of its own', async () => {
    wide(true);
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ showWeather: true, weatherLat: '43.65', weatherLon: '-79.38' })
    );
    await renderApp();
    expect(take()).toContain('/api/weather');
    const ticks = [];
    for (let i = 0; i < 45; i++) {
      await advance(TICK_MS);
      ticks.push(take());
    }
    const slow = ['/api/history', PIPELINE, '/api/weather'];
    for (const [n, tick] of ticks.entries()) {
      expect(tick.length, `tick ${n + 1}: ${tick.join(', ')}`).toBeLessThanOrEqual(4);
      expect(tick.filter((p) => slow.includes(p)).length, `tick ${n + 1}`).toBeLessThanOrEqual(1);
    }
    expect(count(ticks.flat(), '/api/weather')).toBe(2);
  });

  // #673: the pending host steps are read on load and every 5 minutes after,
  // never on the tick; over 22.5 minutes that is four more reads.
  it('reads the pending host steps on load and every 5 minutes, not on the tick', async () => {
    await renderApp();
    // Its chunk is asked for once the browser is idle after the page draws (1.5 s here).
    await advance(2_000);
    expect(count(takeAll(), HOST_ACTIONS)).toBe(1);
    const reads = [];
    for (let i = 0; i < 45; i++) {
      await advance(TICK_MS);
      reads.push(count(takeAll(), HOST_ACTIONS));
    }
    // 22.5 minutes on from the first read: one every 5 minutes, none on most ticks.
    expect(reads.reduce((a, b) => a + b, 0)).toBe(4);
    expect(reads.filter((n) => n > 0).length).toBe(4);
  });

  // #675: the Backups section keeps the same clock: on load, then every 5 minutes.
  it('reads the backups on load and every 5 minutes, not on the tick', async () => {
    await renderApp();
    await advance(2_000);
    expect(count(takeAll(), BACKUPS)).toBe(1);
    const reads = [];
    for (let i = 0; i < 45; i++) {
      await advance(TICK_MS);
      reads.push(count(takeAll(), BACKUPS));
    }
    expect(reads.reduce((a, b) => a + b, 0)).toBe(4);
    expect(reads.filter((n) => n > 0).length).toBe(4);
  });

  it('asks nothing for the backups with their section switched off', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ overviewSections: { backupFreshness: false } })
    );
    await renderApp();
    const load = takeAll();
    await advance(6 * 60_000);
    expect(count([...load, ...takeAll()], BACKUPS)).toBe(0);
  });

  it('asks nothing for them with the section switched off', async () => {
    localStorage.setItem(
      'jaghelm-config',
      JSON.stringify({ overviewSections: { hostActions: false } })
    );
    await renderApp();
    const load = takeAll();
    await advance(6 * 60_000);
    expect(count([...load, ...takeAll()], HOST_ACTIONS)).toBe(0);
  });

  // #674: the config drift row keeps the same clock; with its section off, nothing is asked.
  it('reads config drift on load and every 5 minutes, not on the tick', async () => {
    await renderApp();
    await advance(2_000);
    expect(count(takeAll(), DRIFT)).toBe(1);
    let total = 0;
    for (let i = 0; i < 45; i++) {
      await advance(TICK_MS);
      total += count(takeAll(), DRIFT);
    }
    expect(total).toBe(4);
  });

  it('asks nothing for config drift with the section switched off', async () => {
    localStorage.setItem('jaghelm-config', JSON.stringify({ overviewSections: { configDrift: false } }));
    await renderApp();
    const load = takeAll();
    await advance(6 * 60_000);
    expect(count([...load, ...takeAll()], DRIFT)).toBe(0);
  });

  // #676: the Expiry list is read on load and every 30 minutes after, never on the tick.
  it('reads the expiry list on load and every 30 minutes, not on the tick', async () => {
    await renderApp();
    await advance(2_000);
    expect(count(takeAll(), EXPIRY)).toBe(1);
    const reads = [];
    for (let i = 0; i < 70; i++) {
      await advance(TICK_MS);
      reads.push(count(takeAll(), EXPIRY));
    }
    // 35 minutes on from the first read: one more, and none on any other tick.
    expect(reads.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('asks nothing for it with the section switched off', async () => {
    localStorage.setItem('jaghelm-config', JSON.stringify({ overviewSections: { expiry: false } }));
    await renderApp();
    const load = takeAll();
    await advance(40 * 60_000);
    expect(count([...load, ...takeAll()], EXPIRY)).toBe(0);
  });

  // #751 (spec §7): the Monitoring page's one extra request. It rides the status
  // poll, so a tick costs the status and this, at most once a step (a minute at
  // 1 h); the Overview's board does not tick behind it.
  describe('the Monitoring page (tickBudget.js)', () => {
    const openMonitoring = async () => {
      await renderApp();
      take();
      fireEvent.click(entry('Monitoring'));
      await advance(500);
    };

    it('reads once as it opens, then at most once a minute on the status poll, nothing else', async () => {
      await openMonitoring();
      const opened = takeAll();
      expect(count(opened, '/api/monitoring')).toBe(1);
      const reads = [];
      for (let i = 0; i < 20; i++) {
        await advance(TICK_MS);
        const tick = take();
        reads.push(count(tick, '/api/monitoring'));
        // The page is not the Overview: no board tick, so nothing but the poll and this.
        expect(tick.filter((p) => p !== '/api/status' && p !== '/api/monitoring'), `tick ${i + 1}`).toEqual([]);
        expect(tick.length, `tick ${i + 1}`).toBeLessThanOrEqual(2);
        expect(reads.at(-1), `tick ${i + 1}`).toBeLessThanOrEqual(1);
      }
      // 10 minutes: a read per minute at the 1 h range's step, never one per 30 s poll.
      const total = reads.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(8);
      expect(total).toBeLessThanOrEqual(10);
    });

    it('asks nothing in a hidden tab, and nothing after leaving the page', async () => {
      await openMonitoring();
      takeAll();
      setHidden(true);
      await advance(3 * TICK_MS);
      expect(takeAll()).toEqual([]);
      setHidden(false);
      fireEvent.click(entry('Overview'));
      await advance(500);
      takeAll();
      await advance(5 * 60_000);
      expect(count(takeAll(), '/api/monitoring')).toBe(0);
    });

    it('is not read by the Overview', async () => {
      await renderApp();
      const all = [...takeAll()];
      for (let i = 0; i < 10; i++) {
        await advance(TICK_MS);
        all.push(...takeAll());
      }
      expect(count(all, '/api/monitoring')).toBe(0);
    });
  });

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
    await vi.waitFor(() => screen.getByRole('heading', { level: 1, name: 'Settings' }));
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
        tabs: [{ id: 'netdata', label: 'Netdata', type: 'iframe', url: 'https://netdata.example' }],
      })
    );
    await renderApp();
    take();
    fireEvent.click(entry('Netdata'));
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
