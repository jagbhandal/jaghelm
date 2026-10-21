import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { entityAnchor } from './shell/entityAnchors.js';
import { setReadOnlyServer } from './api/client.js';
import { forgetLocalChanges } from './hooks/useData.js';
import { VIEW_PREF } from './shell/infrastructureView.js';
import { nasDiskIncident } from './testing/statusFixtures.js';
// The demo server's own answers: the same function its /api guard answers with.
import { demoResponse } from '../server/demo.js';

// The demo render test (#248): the whole web app, every /api request answered
// by the demo server's guard, must show a populated board (nodes, services,
// Quick Launch, the UPS and Pipeline panels), a status that is not green while
// a service is down, and save nothing (no write request, no "couldn't save"
// toast) on load. What a visitor changes is kept in the browser for the visit,
// with no error and no request.

let requests;
let notFound; // the requests the demo answered 404, as it answers a path it doesn't know
// How /api/status answers from now on: 'ok' (the demo's), 'down' (a network
// error, as a server that can't be reached) or 'expired' (a 503, as the server
// answers once its status is past the cache's TTL).
let statusAnswer = 'ok';

/**
 * Answer every request as the demo server would, in `scenario`, recording each;
 * `edit` maps a path to a change to the demo's answer to it. A path in `hold`
 * is never answered, and one in `fail` is answered 503.
 */
function routeToDemo(scenario, edit = {}, { hold = [], fail = [] } = {}) {
  requests = [];
  notFound = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = new URL(String(input), 'http://demo.test');
      const method = (init.method || 'GET').toUpperCase();
      requests.push(`${method} ${url.pathname}`);
      if (url.pathname === '/api/status' && statusAnswer === 'down')
        throw new TypeError('Failed to fetch');
      if (url.pathname === '/api/status' && statusAnswer === 'expired')
        return new Response(JSON.stringify({ error: 'Status not yet available' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      if (hold.includes(url.pathname)) return new Promise(() => {});
      if (fail.includes(url.pathname))
        return new Response(JSON.stringify({ error: 'unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      const out = demoResponse({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        scenario,
      });
      if (out.status === 404) notFound.push(`${method} ${url.pathname}`);
      if (out.location)
        return new Response(null, { status: out.status, headers: { Location: out.location } });
      const body = edit[url.pathname] ? edit[url.pathname](out.body) : out.body;
      return new Response(JSON.stringify(body), {
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
async function renderDemo(scenario, edit, { path = '/', ready = 'Network Edge', hold, fail } = {}) {
  routeToDemo(scenario, edit, { hold, fail });
  window.history.replaceState(null, '', path);
  await act(async () => {
    render(<App />);
  });
  await advance(3000);
  expect(legacy(ready)).toBeInTheDocument();
}

// The header's status link (#296): the lamp's state, and what it says.
const headerStatus = () =>
  within(within(screen.getByRole('banner')).getByRole('status')).getByRole('link');

/** The demo's own /api/status in `scenario`: the model's status of its board (#437). */
const demoStatus = (scenario) =>
  demoResponse({ method: 'GET', path: '/api/status', query: {}, scenario }).body;
// A panel of today's board, by its title. A node's name is also on its card in
// the Infrastructure section (#299), so the title is the one in a panel.
const legacy = (title) => {
  const all = screen.getAllByText(title);
  return all.find((el) => el.closest('.glass-card')) ?? all[0];
};
const panel = (title) => legacy(title).closest('.glass-card');
const gridItem = (title) => legacy(title).closest('.helmgrid-item');

beforeEach(() => {
  localStorage.clear();
  statusAnswer = 'ok';
  vi.useFakeTimers();
  // jsdom has no layout: give the grid a desktop width so it renders its panels.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
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
      expect(legacy(name)).toBeInTheDocument();
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

    // The header says what the demo's status model says: critical, a service down.
    expect(demoStatus('incident').overall.sentence).toMatch(/^1 service down/);
    expect(headerStatus()).toHaveAccessibleName(
      `Critical: ${demoStatus('incident').overall.sentence}`
    );
    expect(headerStatus()).toHaveAttribute('data-state', 'crit');
    // One service card is down (its status badge reads "down"): Jellyfin's.
    expect(screen.getAllByText('down')).toHaveLength(1);
    const card = within(panel('App Server')).getByText('down').parentElement.parentElement;
    expect(within(card).getByText('Jellyfin')).toBeInTheDocument();
  });

  it('is green in the healthy scenario', async () => {
    await renderDemo('healthy');

    // The quiet line: the model's sentence, never a green word.
    expect(headerStatus()).toHaveAccessibleName(
      `All systems normal: ${demoStatus('healthy').overall.sentence}`
    );
    expect(headerStatus()).toHaveAttribute('data-state', 'ok');
    expect(screen.queryAllByText('down')).toEqual([]);
    expect(screen.getAllByText('running').length).toBeGreaterThan(10);
  });

  it('saves nothing on load: no write request and no save toast', async () => {
    await renderDemo('incident');

    expect(requests.filter((r) => !r.startsWith('GET '))).toEqual([]);
    expect(screen.queryByText(/Couldn.t save/)).not.toBeInTheDocument();
  });

  it.each(['incident', 'healthy'])(
    'reads on load only what the demo answers: no request is a 404 (%s, #437)',
    async (scenario) => {
      await renderDemo(scenario);

      expect(requests.length).toBeGreaterThan(5);
      expect(notFound).toEqual([]);
    }
  );

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

// The top of the Overview (#297): the model's issues over the board, each row a
// link to its entity's place on the board, until entities have URLs (#309).
describe("the demo's Overview status", () => {
  const place = (entityId) => document.getElementById(entityAnchor(entityId));
  const rowLinks = () =>
    within(screen.getByRole('region', { name: 'Needs attention' }))
      .getAllByRole('listitem')
      .map((row) => within(row).getByRole('link'));

  it("each place on the board carries its entity's anchor", async () => {
    await renderDemo('incident');

    expect(within(place('services/apps:jellyfin')).getByText('Jellyfin')).toBeInTheDocument();
    expect(panel('App Server')).toContainElement(place('services/apps:jellyfin'));
    // A node's place is its card in the Infrastructure section (#299); its
    // panel below, with its service cards, carries no anchor.
    expect(place('nodes/apps')).toHaveAttribute('data-slot', 'node-card');
    expect(place('nodes/apps')).toHaveAccessibleName('App Server');
    expect(document.querySelectorAll(`[id="${entityAnchor('nodes/apps')}"]`)).toHaveLength(1);
    expect(place('power/ups')).toBe(panel('UPS Power'));
    expect(within(place('jobs/storage:nightly-backup')).getByText('nightly-backup')).toBeTruthy();
    expect(panel('Scheduled Jobs')).toContainElement(place('jobs/storage:nightly-backup'));
  });

  it('incident: a click on a row moves to its entity on the board', async () => {
    await renderDemo('incident');
    const [jellyfin] = rowLinks();
    expect(jellyfin).toHaveAccessibleName('Jellyfin, Down, Service · apps');
    const card = place('services/apps:jellyfin');
    const scroll = vi.spyOn(card, 'scrollIntoView');

    await act(async () => {
      fireEvent.click(jellyfin);
    });
    expect(document.activeElement).toBe(card);
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(jellyfin).toHaveAttribute('href', `#${entityAnchor('services/apps:jellyfin')}`);
  });

  it('incident: Enter on a row moves there too; a backup leads to its job’s row', async () => {
    await renderDemo('incident');
    // user-event waits on a real timer between keys (Testing Library's async
    // wrapper knows only Jest's fake clock), so the keyboard runs on real ones.
    vi.useRealTimers();
    const user = userEvent.setup();
    const [, backup] = rowLinks();
    expect(backup).toHaveAccessibleName('nightly-backup, Failed, Backup · storage');
    backup.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(place('jobs/storage:nightly-backup'));
  });

  it('a click with a modifier key is the browser’s: the page stays where it is', async () => {
    await renderDemo('incident');
    const [jellyfin] = rowLinks();
    const card = place('services/apps:jellyfin');
    const scroll = vi.spyOn(card, 'scrollIntoView');
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      fireEvent.click(jellyfin, { [modifier]: true });
    }
    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(card);
  });

  // #279: a row whose place the board doesn't draw opens nothing, so it is plain.
  it('with Scheduled Jobs off, the backup’s row is plain content, and Enter does nothing', async () => {
    await renderDemo('incident', {
      '/api/display-config': (config) => ({ ...config, showCronJobs: false }),
    });
    expect(screen.queryByText('Scheduled Jobs')).toBeNull();
    expect(place('jobs/storage:nightly-backup')).toBeNull();
    const rows = within(screen.getByRole('region', { name: 'Needs attention' })).getAllByRole(
      'listitem'
    );
    const backup = rows[1].querySelector('[data-slot="issue-row"]');
    expect(backup).toHaveTextContent('nightly-backup');
    expect(backup.tagName).toBe('DIV');
    expect(within(rows[1]).queryByRole('link')).toBeNull();
    expect(backup).not.toHaveClass('cursor-pointer');
    // Jellyfin's card is still drawn: its row is still a link.
    expect(within(rows[0]).getByRole('link')).toHaveAttribute(
      'href',
      `#${entityAnchor('services/apps:jellyfin')}`
    );

    // Not in the tab order, and Enter or a click on it moves nothing.
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    backup.focus();
    expect(document.activeElement).not.toBe(backup);
    fireEvent.keyDown(backup, { key: 'Enter' });
    fireEvent.click(backup);
    expect(scroll).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    scroll.mockRestore();
  });

  it("healthy: the quiet line, with the model's sentence", async () => {
    await renderDemo('healthy');

    expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent(
      `All systems normal${demoStatus('healthy').overall.sentence}`
    );
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
  });
});

// The subsystem strip (#298): under the status, a tile per subsystem the
// model has anything in, each a toggle that filters the rows above and the
// board below to it, kept in the URL (`?subsystem=`).
describe("the demo's subsystem strip", () => {
  const strip = () => screen.getByRole('region', { name: 'Subsystems' });
  const tile = (name) => within(strip()).getByRole('button', { name: new RegExp(`^${name},`) });
  const attention = () => screen.getByRole('region', { name: 'Needs attention' });
  const rows = () => within(attention()).queryAllByRole('listitem');
  const click = async (el) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };
  // Today's panels, by their titles.
  const NODES = ['Network Edge', 'App Server', 'Storage'];
  const OTHERS = ['UPS Power', 'Pipeline Activity', 'Checklist', 'Scheduled Jobs', 'Quick Launch'];
  const drawn = (titles) =>
    titles.filter((t) => screen.queryAllByText(t).some((el) => el.closest('.glass-card')));

  /** The model's word for a subsystem: its worst entity's, the ranked issues first. */
  function modelWord(status, subsystem) {
    const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
    return (status.issues.find(match) ?? status.entities.find(match)).word;
  }

  for (const scenario of ['incident', 'healthy']) {
    it(`${scenario}: a tile per subsystem the model has anything in, with its state, word and detail`, async () => {
      await renderDemo(scenario);
      const status = demoStatus(scenario);
      const configured = status.subsystems.filter((s) => s.counts.total > 0);
      const left = status.subsystems.filter((s) => s.counts.total === 0);
      // The demo sets up no integration: its tile is left out.
      expect(left.map((s) => s.id)).toEqual(['integrations']);

      const tiles = within(strip()).getAllByRole('button');
      expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(
        configured.map((s) => `${s.name}, ${modelWord(status, s)}, ${s.detail}`)
      );
      configured.forEach((s, n) => {
        expect(tiles[n]).toHaveAttribute('data-state', s.state);
        expect(tiles[n]).toHaveTextContent(s.name);
        expect(tiles[n]).toHaveTextContent(s.detail);
        expect(tiles[n]).toHaveAttribute('aria-pressed', 'false');
      });
      expect(within(strip()).queryByRole('button', { name: /^Integrations/ })).toBeNull();

      // Under the status, in the Overview's status area.
      const area = document.querySelector('[data-slot="overview-status"]');
      const top = within(area).getByRole('region', {
        name: scenario === 'incident' ? 'Needs attention' : 'Status',
      });
      expect(area).toContainElement(strip());
      expect(top.compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('Nodes, clicked: the rows and the board narrow to the nodes; clicked again, all is back', async () => {
    await renderDemo('incident');
    const heading = within(attention()).getByRole('heading', { level: 2 }).textContent;
    expect(rows()).toHaveLength(2);

    await click(tile('Nodes'));
    expect(tile('Nodes')).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?subsystem=nodes');
    // The headline stays the board's; the rows are the nodes', and there are none.
    expect(within(attention()).getByRole('heading', { level: 2 })).toHaveTextContent(heading);
    expect(within(attention()).getByText('Showing Nodes only')).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(within(attention()).getByText('Nothing in Nodes needs attention')).toBeInTheDocument();
    // The board: the node cards alone.
    expect(drawn(NODES)).toEqual(NODES);
    expect(drawn(OTHERS)).toEqual([]);

    await click(tile('Nodes'));
    expect(tile('Nodes')).toHaveAttribute('aria-pressed', 'false');
    expect(window.location.search).toBe('');
    expect(rows()).toHaveLength(2);
    expect(within(attention()).queryByText(/^Showing/)).toBeNull();
    expect(drawn(NODES)).toEqual(NODES);
    expect(drawn(OTHERS)).toEqual(OTHERS);
  });

  it('Services: its rows, and the panels with service cards; one filter at a time; Clear', async () => {
    await renderDemo('incident');
    await click(tile('Services'));
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Jellyfin')]);
    // Its card is drawn, so its row still leads there.
    expect(within(rows()[0]).getByRole('link')).toHaveAttribute(
      'href',
      `#${entityAnchor('services/apps:jellyfin')}`
    );
    expect(drawn(NODES)).toEqual(NODES);
    expect(drawn(OTHERS)).toEqual([]);

    // Another tile moves the filter there.
    await click(tile('Backups'));
    expect(tile('Services')).toHaveAttribute('aria-pressed', 'false');
    expect(tile('Backups')).toHaveAttribute('aria-pressed', 'true');
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('nightly-backup')]);
    expect(drawn(NODES)).toEqual([]);
    expect(drawn(OTHERS)).toEqual(['Scheduled Jobs']);

    await click(within(attention()).getByRole('button', { name: 'Clear' }));
    expect(window.location.search).toBe('');
    expect(rows()).toHaveLength(2);
    expect(drawn(OTHERS)).toEqual(OTHERS);
  });

  it('by keyboard: Space on a tile filters, Enter on it again clears', async () => {
    await renderDemo('incident');
    vi.useRealTimers();
    const user = userEvent.setup();
    tile('Power').focus();
    await user.keyboard(' ');
    expect(tile('Power')).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?subsystem=power');
    expect(drawn(OTHERS)).toEqual(['UPS Power']);
    expect(drawn(NODES)).toEqual([]);
    expect(document.activeElement).toBe(tile('Power'));
    await user.keyboard('{Enter}');
    expect(tile('Power')).toHaveAttribute('aria-pressed', 'false');
    expect(drawn(OTHERS)).toEqual(OTHERS);
  });

  it('the filter is the URL: a link opens filtered, and Back and Forward follow it', async () => {
    await renderDemo('incident', undefined, { path: '/?subsystem=jobs', ready: 'Scheduled Jobs' });
    expect(tile('Jobs')).toHaveAttribute('aria-pressed', 'true');
    expect(drawn(NODES)).toEqual([]);
    expect(rows()).toHaveLength(0);

    await act(async () => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(tile('Jobs')).toHaveAttribute('aria-pressed', 'false');
    expect(drawn(NODES)).toEqual(NODES);

    await act(async () => {
      window.history.replaceState(null, '', '/?subsystem=nodes');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(tile('Nodes')).toHaveAttribute('aria-pressed', 'true');
    expect(drawn(OTHERS)).toEqual([]);
  });

  it.each(['/?subsystem=integrations', '/?subsystem=bogus', '/?subsystem='])(
    "a subsystem the strip doesn't show in the URL (%s): the whole board, and the URL drops it",
    async (path) => {
      window.history.replaceState(null, '', '/');
      const entries = window.history.length;
      await renderDemo('incident', undefined, { path });
      expect(within(strip()).queryByRole('button', { pressed: true })).toBeNull();
      expect(within(attention()).queryByText(/^Showing/)).toBeNull();
      expect(drawn(NODES)).toEqual(NODES);
      expect(drawn(OTHERS)).toEqual(OTHERS);
      // Replaced, not a new entry: Back doesn't return to it, and it can't
      // filter the page later, once that subsystem is set up.
      expect(window.location.pathname + window.location.search).toBe('/');
      expect(window.history.length).toBe(entries);
    }
  );

  // Nothing of the subsystem is on the board. It is set up (the strip shows
  // it), so the note never says it isn't: it says why.
  const note = () => document.querySelector('[data-slot="board-filter-empty"]');
  const NOT_SET_UP = /none yet|not set up|isn't set up/i;

  it('a filter whose panel is switched off says so, and offers the whole board', async () => {
    await renderDemo(
      'incident',
      { '/api/display-config': (config) => ({ ...config, showCronJobs: false }) },
      { path: '/?subsystem=backups', ready: 'Showing Backups only' }
    );
    expect(drawn(NODES)).toEqual([]);
    expect(drawn(OTHERS)).toEqual([]);
    expect(note()).toHaveTextContent(
      'Scheduled Jobs is switched offSwitch it on in Settings to see Backups here.'
    );
    expect(note()).not.toHaveTextContent(NOT_SET_UP);
    await click(within(note()).getByRole('button', { name: 'Show the whole board' }));
    expect(window.location.search).toBe('');
    expect(drawn(NODES)).toEqual(NODES);
    expect(note()).toBeNull();
  });

  it("Power before /api/ups answers: a placeholder, never a note that it isn't set up", async () => {
    await renderDemo('incident', undefined, {
      path: '/?subsystem=power',
      ready: 'Showing Power only',
      hold: ['/api/ups'],
    });
    expect(tile('Power')).toHaveAttribute('aria-pressed', 'true');
    expect(note()).toHaveAttribute('aria-busy', 'true');
    expect(note()).toHaveTextContent(/^Loading the board$/);
    expect(note()).not.toHaveTextContent(NOT_SET_UP);
    expect(drawn(NODES)).toEqual([]);
  });

  it('Power with /api/ups failing: no UPS reading, with what the status says, never "none yet"', async () => {
    await renderDemo('incident', undefined, {
      path: '/?subsystem=power',
      ready: 'Showing Power only',
      fail: ['/api/ups'],
    });
    const power = demoStatus('incident').subsystems.find((s) => s.id === 'power');
    expect(note()).toHaveTextContent(
      `No UPS reading on the boardPower, as the status reads it: ${power.detail}.`
    );
    expect(note()).not.toHaveTextContent(NOT_SET_UP);
    expect(note()).not.toHaveTextContent(/switched off/);
    expect(
      within(note()).getByRole('button', { name: 'Show the whole board' })
    ).toBeInTheDocument();
  });

  it('Services with a saved layout while /api/services is out: its nodes loading, no note', async () => {
    const lg = ['edge', 'apps', 'storage'].map((n, k) => ({
      i: `node-${n}`,
      x: k * 8,
      y: 0,
      w: 8,
      h: 8,
    }));
    await renderDemo(
      'incident',
      { '/api/display-config': (config) => ({ ...config, gridLayout: { lg } }) },
      { path: '/?subsystem=services', ready: 'Showing Services only', hold: ['/api/services'] }
    );
    expect(screen.getByText('Loading edge…')).toBeInTheDocument();
    expect(screen.getByText('Loading storage…')).toBeInTheDocument();
    expect(note()).toBeNull();
  });

  // A node whose services all moved into a custom group draws no service card
  // of its own: Services leaves its card out and keeps the group; Nodes keeps
  // every node card and leaves the group out.
  it('a node whose services all moved into a group: Services keeps the group, not the node', async () => {
    const group = {
      id: 'edge-apps',
      title: 'Edge apps',
      containers: ['edge:adguard-home', 'edge:nginx-proxy-manager', 'edge:wireguard'],
    };
    await renderDemo(
      'incident',
      { '/api/display-config': (config) => ({ ...config, customGroups: [group] }) },
      { ready: 'Edge apps' }
    );
    await click(tile('Services'));
    expect(drawn(['Edge apps', ...NODES])).toEqual(['Edge apps', 'App Server', 'Storage']);
    await click(tile('Nodes'));
    expect(drawn(['Edge apps', ...NODES])).toEqual(NODES);
    await click(tile('Nodes'));
    expect(drawn(['Edge apps', ...NODES])).toEqual(['Edge apps', ...NODES]);
  });

  // A drag or resize saves the layout it sees, so a filtered board can't be
  // rearranged: it would save the board without the panels it hides.
  it('a filtered board has no move handles, so its layout is never saved without the rest', async () => {
    await renderDemo('incident');
    const handles = () => screen.queryAllByRole('button', { name: /^Reposition / });
    const all = handles().length;
    expect(all).toBeGreaterThan(5);
    await click(tile('Nodes'));
    expect(handles()).toEqual([]);
    expect(document.querySelectorAll('.helmgrid-resize-handle')).toHaveLength(0);
    await click(tile('Nodes'));
    expect(handles()).toHaveLength(all);
  });
});

// The Infrastructure section (#299, spec §8 item 3): above today's board, a
// card per node the model has, or a table; the node's state the model's, its
// meters coloured only at or over the lines /api/status serves.
describe("the demo's Infrastructure section", () => {
  const section = () => screen.getByRole('region', { name: 'Infrastructure' });
  const card = (name) => within(section()).getByRole('article', { name });
  const place = (entityId) => document.getElementById(entityAnchor(entityId));
  const strip = () => screen.getByRole('region', { name: 'Subsystems' });
  const tile = (name) => within(strip()).getByRole('button', { name: new RegExp(`^${name},`) });
  const click = async (el) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };

  for (const scenario of ['incident', 'healthy']) {
    it(`${scenario}: a card per node the model has, in its state, above the board`, async () => {
      await renderDemo(scenario);
      const status = demoStatus(scenario);
      const nodes = status.entities.filter((e) => e.kind === 'node');
      const services = demoResponse({ method: 'GET', path: '/api/services', query: {}, scenario });
      const cards = within(section()).getAllByRole('article');
      // In services.yaml's order, as the board lays its panels out.
      expect(cards.map((c) => c.dataset.node)).toEqual(
        Object.keys(services.body.nodes).map((k) => `nodes/${k}`)
      );
      expect(cards).toHaveLength(nodes.length);
      for (const e of nodes) {
        expect(card(e.name)).toHaveAttribute('data-state', e.state);
        // Healthy: the lamp, named by the model's word, and nothing louder.
        expect(within(card(e.name)).getByRole('img', { name: e.word })).toBeInTheDocument();
      }
      expect(within(section()).getByText(`${nodes.length} nodes`)).toBeInTheDocument();
      // Every meter neutral: the demo's readings are all under their lines.
      const meters = section().querySelectorAll('[data-slot="metric-meter"]');
      expect(meters.length).toBeGreaterThan(0);
      for (const m of meters) {
        expect(m).toHaveAttribute('data-state', 'ok');
        expect(m.querySelector('[data-slot="meter-fill"]')).toHaveClass('bg-meter');
      }
      // Above today's board.
      const board = document.querySelector('.helmgrid-item');
      expect(
        section().compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  }

  it('the incident: the NAS at 94.6 % disk reads as a warning, 94, and its row leads to its card', async () => {
    const board = nasDiskIncident({ now: Date.now() });
    await renderDemo('incident', {
      '/api/status': () => board.status,
      '/api/services': () => board.services,
    });
    const nas = card('Storage');
    expect(nas).toHaveAttribute('data-state', 'warn');
    expect(within(nas).getByText('Warning')).toBeInTheDocument();
    expect(nas).toHaveTextContent('Disk 94 % (warning above 90 %)');
    const disk = nas.querySelector('[data-reading="disk"]');
    expect(disk).toHaveAttribute('data-state', 'warn');
    expect(disk).toHaveAttribute('aria-valuetext', '94%, warning above 90%');
    expect(within(section()).getByText('3 nodes · 1 warning')).toBeInTheDocument();

    const row = within(screen.getByRole('region', { name: 'Needs attention' })).getByRole('link', {
      name: /^Storage, Warning/,
    });
    expect(row).toHaveAttribute('href', `#${entityAnchor('nodes/storage')}`);
    await click(row);
    expect(document.activeElement).toBe(nas);
  });

  it('Nodes: the section stays, with the node panels; another filter hides it, and the panel takes the anchor', async () => {
    await renderDemo('incident');
    await click(tile('Nodes'));
    expect(section()).toBeInTheDocument();
    expect(place('nodes/apps')).toBe(card('App Server'));
    expect(panel('App Server')).toBeInTheDocument();

    // Services: the section is the Nodes subsystem's, so it goes; a service's
    // row can still lead to its node's panel, which carries the anchor again.
    await click(tile('Services'));
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();
    expect(place('nodes/apps')).toContainElement(panel('App Server'));

    await click(tile('Backups'));
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();
    expect(place('nodes/apps')).toBeNull();

    await click(tile('Backups'));
    expect(place('nodes/apps')).toBe(card('App Server'));
  });

  it('cards or a table, the choice kept in this browser', async () => {
    await renderDemo('incident');
    const view = () => within(section()).getByRole('radiogroup', { name: 'Node view' });
    expect(within(view()).getByRole('radio', { name: 'Cards' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await click(within(view()).getByRole('radio', { name: 'Table' }));
    expect(localStorage.getItem(VIEW_PREF)).toBe('table');
    const table = within(section()).getByRole('table', { name: 'Nodes' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(section()).queryAllByRole('article')).toEqual([]);
    // The anchor moves with it: the node's name in its row.
    expect(within(table).getAllByRole('rowheader')[1]).toContainElement(place('nodes/apps'));
  });

  it('opens in the view this browser kept', async () => {
    localStorage.setItem(VIEW_PREF, 'table');
    await renderDemo('healthy');
    expect(within(section()).getByRole('table', { name: 'Nodes' })).toBeInTheDocument();
  });

  it('with storage blocked: cards, and the toggle still works for the visit', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === VIEW_PREF) throw new Error('SecurityError');
      return null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === VIEW_PREF) throw new Error('QuotaExceededError');
    });
    await renderDemo('healthy');
    expect(within(section()).getAllByRole('article').length).toBeGreaterThan(0);
    await click(within(section()).getByRole('radio', { name: 'Table' }));
    expect(within(section()).getByRole('table', { name: 'Nodes' })).toBeInTheDocument();
  });
});

// The one rule for a stale status (#480, #495): when the header's poll has no
// current status (it can't reach the server, or the server's status is past
// its TTL), nothing on screen is drawn in a level colour from the last one:
// the header, the attention panel, the subsystem strip and the
// Infrastructure section. Each keeps what it last knew and says how old it
// is, by one clock; the next answer brings every colour back at once.
describe('No signal: a stale status never looks current', () => {
  const header = () => within(screen.getByRole('banner')).getByRole('status');
  const area = () => document.querySelector('[data-slot="overview-status"]');
  const attention = () => within(area()).getByRole('region', { name: 'Needs attention' });
  const strip = () => within(area()).getByRole('region', { name: 'Subsystems' });
  const section = () => screen.getByRole('region', { name: 'Infrastructure' });
  const places = () => [header(), area(), section()];

  // A class that paints a level's colour: ok's green, warn's amber, crit's red
  // (text, fills, tints, gradients, edges, SVG paint), with any variant prefix.
  const LEVEL =
    /^(?:[\w-]+:)*(?:text|bg|from|via|to|fill|stroke|border|ring|inset-ring|outline|decoration)-(?:ok|warn|crit)-/;
  /** Every element in `root` drawn in a level's colour, or marked with a level. */
  function levels(root) {
    return [root, ...root.querySelectorAll('*')].flatMap((el) => {
      const painted = [...el.classList].filter((c) => LEVEL.test(c));
      const state = ['ok', 'warn', 'crit'].includes(el.dataset.state)
        ? [`data-state=${el.dataset.state}`]
        : [];
      const said = [...painted, ...state];
      return said.length
        ? [`${el.dataset.slot ?? el.tagName.toLowerCase()}: ${said.join(' ')}`]
        : [];
    });
  }

  /** How old each place says the status is: the header, the panel, every tile, the section. */
  function ages() {
    const age = (text) => /last known (.+?)(?::|$)/i.exec(text)?.[1] ?? null;
    return {
      header: age(
        within(header()).getByRole('link').getAttribute('aria-label') ?? header().textContent
      ),
      panel: age(within(attention()).getByRole('heading', { level: 2 }).textContent),
      tiles: within(strip())
        .getAllByRole('button')
        .map((t) => age(t.textContent)),
      section: age(within(section()).getByText(/^\d+ nodes/).textContent),
    };
  }

  async function renderNasIncident() {
    const board = nasDiskIncident({ now: Date.now() });
    await renderDemo('incident', {
      '/api/status': () => board.status,
      '/api/services': () => board.services,
    });
    return board;
  }

  const nas = () => within(section()).getByRole('article', { name: 'Storage' });
  // renderDemo lets 3 s pass after the first answer, and the poll asks every
  // 30 s: the next poll asks 27 s on, when the last answer is 30 s old.
  const untilTheNextPoll = () => advance(27_000);

  for (const [answer, cause] of [
    ['down', "Can't reach JagHelm"],
    ['expired', "JagHelm's status is out of date"],
  ]) {
    it(`${answer === 'down' ? 'the server unreachable' : 'the status past its TTL (503)'}: no level colour anywhere, each place saying how old`, async () => {
      await renderNasIncident();
      // Fresh: red, amber and green are where the model puts them, so the
      // probe below can't pass by finding nothing.
      const fresh = places().flatMap(levels).join('\n');
      expect(fresh).toMatch(/crit/);
      expect(fresh).toMatch(/warn/);
      expect(nas()).toHaveAttribute('data-state', 'warn');

      statusAnswer = answer;
      await untilTheNextPoll();

      for (const place of places()) expect(levels(place), place.dataset.slot).toEqual([]);
      // The header: the steel ring, "No signal", what it last knew.
      expect(within(header()).getByRole('link')).toHaveAccessibleName(
        'No signal: last known 30 s ago: Critical · 2 critical, 1 warning'
      );
      // The panel: the same words, why under them, its rows kept, each a steel ring.
      expect(attention()).toHaveAttribute('data-state', 'unknown');
      expect(within(attention()).getByRole('heading', { level: 2 })).toHaveTextContent(
        'No signal · last known 30 s ago: Critical · 2 critical, 1 warning'
      );
      expect(within(attention()).getByText(cause)).toBeInTheDocument();
      expect(area().querySelector('[data-slot="banner"]')).toBeNull();
      const rows = within(attention()).getAllByRole('listitem');
      expect(rows.length).toBe(3);
      expect(rows[0]).toHaveTextContent('Jellyfin');
      for (const lamp of attention().querySelectorAll('[data-slot="status-lamp"]'))
        expect(lamp).toHaveAttribute('data-state', 'unknown');
      // The strip: every tile no signal, its count kept, marked last known.
      for (const t of within(strip()).getAllByRole('button')) {
        expect(t).toHaveAttribute('data-state', 'unknown');
        expect(t).toHaveTextContent(/\d+ \/ \d+|On mains|On battery|\d/);
        expect(t).toHaveAccessibleDescription('Last known 30 s ago');
      }
      // Infrastructure: the NAS keeps its word, reason and 94 %, all neutral.
      expect(
        within(section()).getByText('3 nodes · No signal · last known 30 s ago')
      ).toBeInTheDocument();
      expect(nas()).toHaveAttribute('data-state', 'unknown');
      expect(within(nas()).getByText('Warning')).toHaveClass('text-unknown-fg');
      expect(nas()).toHaveTextContent('Disk 94 % (warning above 90 %)');
      const disk = nas().querySelector('[data-reading="disk"]');
      expect(disk).toHaveAttribute('data-state', 'unknown');
      expect(disk).toHaveAttribute('aria-valuetext', '94%, no signal');
      expect(disk.querySelector('[data-slot="meter-fill"]')).toHaveClass('bg-unknown-solid');
      for (const m of section().querySelectorAll('[data-slot="metric-meter"]'))
        expect(m).toHaveAttribute('data-state', 'unknown');
    });
  }

  it('the age keeps moving, and every place reads the same one', async () => {
    await renderNasIncident();
    statusAnswer = 'down';
    await untilTheNextPoll();
    const tiles = within(strip()).getAllByRole('button').length;
    expect(ages()).toEqual({
      header: '30 s ago',
      panel: '30 s ago',
      tiles: Array(tiles).fill('30 s ago'),
      section: '30 s ago',
    });
    for (const [ms, said] of [
      [17_000, '47 s ago'],
      [4 * 60_000, '4 min ago'],
    ]) {
      await advance(ms);
      expect(ages()).toEqual({
        header: said,
        panel: said,
        tiles: Array(tiles).fill(said),
        section: said,
      });
    }
    // The header's own "Updated" says the same age.
    expect(within(screen.getByRole('banner')).getByText('Updated 4 min ago')).toBeInTheDocument();
  });

  it('back to fresh: every colour returns with the answer that brings it', async () => {
    await renderNasIncident();
    const fresh = () => ({
      header: within(header()).getByRole('link').dataset.state,
      panel: attention().dataset.state,
      tiles: within(strip())
        .getAllByRole('button')
        .map((t) => t.dataset.state),
      nas: nas().dataset.state,
      disk: nas().querySelector('[data-reading="disk"]').dataset.state,
    });
    const before = fresh();
    expect(before).toMatchObject({ header: 'crit', panel: 'crit', nas: 'warn', disk: 'warn' });

    statusAnswer = 'down';
    await untilTheNextPoll();
    expect(places().flatMap(levels)).toEqual([]);

    // One poll: the next answer brings every place back together.
    statusAnswer = 'ok';
    await advance(30_000);
    expect(fresh()).toEqual(before);
    expect(screen.queryByText(/last known/i)).toBeNull();
    expect(within(section()).getByText('3 nodes · 1 warning')).toBeInTheDocument();
  });
});
