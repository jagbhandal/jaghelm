import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import { setReadOnlyServer } from './api/client.js';
import { forgetLocalChanges } from './hooks/useData.js';
// The demo server's own answers: the same function its /api guard answers with.
import { demoResponse } from '../server/demo.js';

// The demo render test (#248): the whole web app, every /api request answered
// by the demo server's guard, must show a populated board (nodes, services,
// Quick Launch, the UPS and Pipeline panels), a status that is not green while
// a service is down, and save nothing (no write request, no "couldn't save"
// toast) on load. What a visitor changes is kept in the browser for the visit,
// with no error and no request.

let requests;

/** Answer every request as the demo server would, in `scenario`, recording each. */
function routeToDemo(scenario) {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = new URL(String(input), 'http://demo.test');
      const method = (init.method || 'GET').toUpperCase();
      requests.push(`${method} ${url.pathname}`);
      const out = demoResponse({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        scenario,
      });
      if (out.location)
        return new Response(null, { status: out.status, headers: { Location: out.location } });
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Render the app and let it load, then wait out the settings save debounce
 * (2 s). The render, every answer and the timers all run inside act(), so each
 * update is applied before the test looks (and React has nothing to warn of).
 */
async function renderDemo(scenario) {
  routeToDemo(scenario);
  await act(async () => {
    render(<App />);
  });
  await advance(3000);
  expect(screen.getByText('Network Edge')).toBeInTheDocument();
}

// The header's status link (#296): the lamp's state, and what it says.
const headerStatus = () =>
  within(within(screen.getByRole('banner')).getByRole('status')).getByRole('link');

/**
 * What the header must say for the demo's own /api/status answer in
 * `scenario`: the model's word and sentence; or, for an answer without a
 * status, "No signal" while it waits for one.
 */
function expectedHeader(scenario) {
  const { body } = demoResponse({ method: 'GET', path: '/api/status', query: {}, scenario });
  if (!body?.overall) return 'No signal: Waiting for the first check';
  const { state, sentence } = body.overall;
  const word = { crit: 'Critical', warn: 'Warning', unknown: 'No signal' }[state] ?? 'All systems normal';
  return `${word}: ${sentence}`;
}
const panel = (title) => screen.getByText(title).closest('.glass-card');
const gridItem = (title) => screen.getByText(title).closest('.helmgrid-item');

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // jsdom has no layout: give the grid a desktop width so it renders its panels.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The app marked the server read-only and may have kept changes: start afresh.
  setReadOnlyServer(false);
  forgetLocalChanges();
});

describe('the demo, rendered', () => {
  it('shows populated nodes with their services, side by side at the top', async () => {
    await renderDemo('incident');

    for (const name of ['Network Edge', 'App Server', 'Storage']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(within(panel('App Server')).getByText('Nextcloud')).toBeInTheDocument();
    expect(within(panel('Network Edge')).getByText('Adguard Home')).toBeInTheDocument();
    expect(within(panel('Storage')).getByText('Syncthing')).toBeInTheDocument();
    expect(screen.queryByText('Connect your first node')).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading /)).not.toBeInTheDocument();

    // No saved layout: the board lays itself out, the three nodes in one row on top.
    const tops = ['Network Edge', 'App Server', 'Storage'].map((n) => gridItem(n).style.top);
    const lefts = ['Network Edge', 'App Server', 'Storage'].map((n) =>
      parseFloat(gridItem(n).style.left)
    );
    expect(new Set(tops).size).toBe(1);
    expect(lefts[0]).toBeLessThan(lefts[1]);
    expect(lefts[1]).toBeLessThan(lefts[2]);
    for (const title of ['UPS Power', 'Pipeline Activity', 'Quick Launch']) {
      expect(parseFloat(gridItem(title).style.top)).toBeGreaterThan(parseFloat(tops[0]));
    }
  });

  it('shows the Quick Launch links, and the UPS, Pipeline and Scheduled Jobs panels with their data', async () => {
    await renderDemo('incident');

    const quickLaunch = panel('Quick Launch');
    expect(within(quickLaunch).getByRole('link', { name: 'Grafana' })).toHaveAttribute(
      'href',
      'https://grafana.example.com'
    );
    expect(within(quickLaunch).getAllByRole('link')).toHaveLength(9);

    expect(within(panel('UPS Power')).getByText('Online')).toBeInTheDocument();
    expect(within(panel('UPS Power')).getByText('Example UPS 1500VA')).toBeInTheDocument();
    expect(
      within(panel('Pipeline Activity')).getByText('Pin the reverse proxy image to 2.12')
    ).toBeInTheDocument();
    expect(within(panel('Scheduled Jobs')).getByText('nightly-backup')).toBeInTheDocument();
  });

  it('is not green while a service is down', async () => {
    await renderDemo('incident');

    // The header says what the demo's /api/status says, and never all clear.
    expect(headerStatus()).toHaveAccessibleName(expectedHeader('incident'));
    expect(headerStatus()).not.toHaveAttribute('data-state', 'ok');
    // One service card is down (its status badge reads "down"): Jellyfin's.
    expect(screen.getAllByText('down')).toHaveLength(1);
    const card = within(panel('App Server')).getByText('down').parentElement.parentElement;
    expect(within(card).getByText('Jellyfin')).toBeInTheDocument();
  });

  it('is green in the healthy scenario', async () => {
    await renderDemo('healthy');

    // Never red or amber; the header says what the demo's /api/status says.
    expect(headerStatus()).toHaveAccessibleName(expectedHeader('healthy'));
    expect(['crit', 'warn']).not.toContain(headerStatus().getAttribute('data-state'));
    expect(screen.queryAllByText('down')).toEqual([]);
    expect(screen.getAllByText('running').length).toBeGreaterThan(10);
  });

  it('saves nothing on load: no write request and no save toast', async () => {
    await renderDemo('incident');

    expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
    expect(screen.queryByText(/Couldn.t save/)).not.toBeInTheDocument();
  });

  it('keeps a change in the browser with no error and no request: a checklist item, a scheduled job', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await renderDemo('incident');
    const click = async (el) => {
      await act(async () => {
        fireEvent.click(el);
      });
      // Past the refetch and any save debounce.
      await advance(3000);
    };

    // Tick a checklist item: it stays ticked.
    const checklist = panel('Checklist');
    expect(within(checklist).getByText('2 remaining')).toBeInTheDocument();
    const renew = () =>
      within(panel('Checklist'))
        .getByText('Renew the TLS certificate for the proxy')
        .closest('.todo-item');
    await click(within(renew()).getByRole('checkbox'));
    expect(within(renew()).getByRole('checkbox')).toBeChecked();
    expect(within(panel('Checklist')).getByText('1 remaining')).toBeInTheDocument();

    // Remove the failed backup job: it stays gone after the board refetches.
    const backupRow = within(panel('Scheduled Jobs')).getByText('nightly-backup').parentElement;
    await click(within(backupRow).getByRole('button', { name: 'Remove' }));
    expect(within(panel('Scheduled Jobs')).queryByText('nightly-backup')).not.toBeInTheDocument();
    expect(within(panel('Scheduled Jobs')).getByText('scrub-check')).toBeInTheDocument();

    expect(screen.queryByText(/Couldn.t save/)).not.toBeInTheDocument();
    expect(alert).not.toHaveBeenCalled();
    expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
  });
});
