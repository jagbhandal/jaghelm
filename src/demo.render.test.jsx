import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { entityAnchor } from './shell/entityAnchors.js';
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
let notFound; // the requests the demo answered 404, as it answers a path it doesn't know

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
  expect(screen.getByText(ready)).toBeInTheDocument();
}

// The header's status link (#296): the lamp's state, and what it says.
const headerStatus = () =>
  within(within(screen.getByRole('banner')).getByRole('status')).getByRole('link');

/** The demo's own /api/status in `scenario`: the model's status of its board (#437). */
const demoStatus = (scenario) =>
  demoResponse({ method: 'GET', path: '/api/status', query: {}, scenario }).body;
const panel = (title) => screen.getByText(title).closest('.glass-card');
const gridItem = (title) => screen.getByText(title).closest('.helmgrid-item');

beforeEach(() => {
  localStorage.clear();
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
    expect(place('nodes/apps')).toContainElement(panel('App Server'));
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
  const drawn = (titles) => titles.filter((t) => screen.queryByText(t));

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
