import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.jsx';
import { entityAnchor } from './shell/entityAnchors.js';
import { appEntryOf, integrationClaims } from './shell/useAppDataMatching.js';
import { headlineMetric } from './shell/servicesView.js';
import { RAIL_WIDTH } from '@ui/app-shell';
import { setReadOnlyServer } from './api/client.js';
import { forgetLocalChanges } from './hooks/useData.js';
import { forgetRemoved } from './shell/removedJobs.js';
import { VIEW_PREF } from './shell/infrastructureView.js';
import { GROUPING_PREF } from './shell/servicesView.js';
import { nasDiskIncident } from './testing/statusFixtures.js';
// The demo server's own answers: the same function its /api guard answers with.
import { demoResponse } from '../server/demo.js';

// The demo render test (#248): the whole web app, every /api request answered
// by the demo server's guard, must show a populated Overview (the nodes, the
// UPS, the jobs and the services, and from 1440px the rail's Quick Launch,
// Pipeline and Checklist), a status that is not green while a service is down,
// and save nothing (no write request, no "couldn't save" toast) on load. What a visitor changes is kept in the browser for the visit,
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

/** The drawer named `name` (#309), once its chunk and the floating layer have answered. */
async function drawer(name) {
  await advance(50);
  return screen.getByRole('dialog', { name });
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
  expect(screen.getAllByText(ready)[0]).toBeInTheDocument();
}

// The header's status link (#296): the lamp's state, and what it says.
const headerStatus = () =>
  screen.getByRole('banner').querySelector('[data-slot="header-status"] a[href="/alerts"]');

/** The demo's own /api/status in `scenario`: the model's status of its board (#437). */
const demoStatus = (scenario) =>
  demoResponse({ method: 'GET', path: '/api/status', query: {}, scenario }).body;
// The Overview's sections under the strip (OverviewBoard.jsx, #306), as drawn,
// in their order.
const SECTIONS = ['Infrastructure', 'Power', 'Jobs', 'Services'];
const sectionsDrawn = () =>
  SECTIONS.filter((name) => screen.queryByRole('region', { name }) !== null);
const region = (name) => screen.getByRole('region', { name });

/** A window from 1440px: the Overview draws its utilities rail (#301). */
function wide() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === RAIL_WIDTH,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}
// The Services section (#300), a group's list in it, and every row it draws.
const servicesSection = () => screen.getByRole('region', { name: 'Services' });
const serviceGroup = (title) => within(servicesSection()).getByRole('list', { name: title });
const serviceRowEls = () => [...servicesSection().querySelectorAll('[data-slot="entity-row"]')];

beforeEach(() => {
  localStorage.clear();
  statusAnswer = 'ok';
  vi.useFakeTimers();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The app marked the server read-only and may have kept changes: start afresh.
  setReadOnlyServer(false);
  forgetLocalChanges();
  forgetRemoved();
  delete document.hidden;
  delete document.visibilityState;
});

/** Hide or show the browser tab, as the Page Visibility API says it. */
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

describe('the demo, rendered', () => {
  it('shows the nodes, the UPS, the jobs and the services, each in its section, in order (#306)', async () => {
    await renderDemo('incident');

    expect(sectionsDrawn()).toEqual(SECTIONS);
    const [infra, power, jobs, services] = SECTIONS.map(region);
    for (const [a, b] of [
      [infra, power],
      [power, jobs],
      [jobs, services],
    ])
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of ['Network Edge', 'App Server', 'Storage']) {
      expect(within(infra).getByRole('article', { name })).toBeInTheDocument();
    }
    // The services are the Services section's (#300), each under its node.
    expect(within(serviceGroup('App Server')).getByText('Nextcloud')).toBeInTheDocument();
    expect(within(serviceGroup('Network Edge')).getByText('Adguard Home')).toBeInTheDocument();
    expect(within(serviceGroup('Storage')).getByText('Syncthing')).toBeInTheDocument();
    // The UPS on mains has its row, and opens its detail (#306).
    const ups = within(power).getByRole('link', { name: 'Example UPS 1500VA, On mains' });
    expect(ups).toHaveAttribute('href', '/?entity=power/ups');
    expect(ups).toHaveTextContent('100 % charge');
    expect(within(power).getByText('On mains')).toBeInTheDocument();
    // The jobs and backups, the failed backup among them.
    expect(within(jobs).getByRole('link', { name: /^nightly-backup, Failed/ })).toBeInTheDocument();
    // No old board: no grid, no first-run note.
    expect(document.querySelector('.helmgrid, .glass-card')).toBeNull();
    expect(screen.queryByText('Connect your first node')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for your first node')).not.toBeInTheDocument();
  });

  it('from 1440px: the rail’s Quick Launch links, Pipeline and Checklist, with their data', async () => {
    wide();
    await renderDemo('incident');
    const rail = region('Utilities');
    const quickLaunch = within(rail).getByRole('region', { name: 'Quick Launch' });
    expect(within(quickLaunch).getByRole('link', { name: 'Netdata' })).toHaveAttribute(
      'href',
      'https://netdata.example.com'
    );
    expect(within(quickLaunch).getAllByRole('link')).toHaveLength(9);
    expect(
      within(within(rail).getByRole('region', { name: 'Pipeline' })).getByText(
        'Pin the reverse proxy image to 2.12'
      )
    ).toBeInTheDocument();
    expect(within(rail).getByRole('region', { name: 'Checklist' })).toBeInTheDocument();
  });

  it('is not green while a service is down', async () => {
    await renderDemo('incident');

    // The header says what the demo's status model says: critical, a service down.
    expect(demoStatus('incident').overall.sentence).toMatch(/^1 service down/);
    expect(headerStatus()).toHaveAccessibleName(
      `Critical: ${demoStatus('incident').overall.sentence}`
    );
    expect(headerStatus()).toHaveAttribute('data-state', 'crit');
    // One service is down, as the model says: Jellyfin's row, red, named "Down".
    const notUp = serviceRowEls().filter((r) => r.dataset.state !== 'ok');
    expect(notUp).toHaveLength(1);
    expect(notUp[0]).toHaveAttribute('data-state', 'crit');
    expect(within(notUp[0]).getByText('Jellyfin')).toBeInTheDocument();
    expect(notUp[0]).toHaveAccessibleName('Jellyfin, Down');
  });

  it('is green in the healthy scenario', async () => {
    await renderDemo('healthy');

    // The quiet line: the model's sentence, never a green word.
    expect(headerStatus()).toHaveAccessibleName(
      `All systems normal: ${demoStatus('healthy').overall.sentence}`
    );
    expect(headerStatus()).toHaveAttribute('data-state', 'ok');
    const rows = serviceRowEls();
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row).toHaveAttribute('data-state', 'ok');
    expect(within(servicesSection()).getByText(`${rows.length} monitored · all up`)).toBeTruthy();
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

  it('keeps a change in the browser with no error and no request: a checklist item, a removed job', async () => {
    wide();
    await renderDemo('incident');
    const click = async (el) => {
      await act(async () => {
        fireEvent.click(el);
      });
      // Past the refetch and any save debounce.
      await advance(3000);
    };

    // Tick a checklist item in the rail: it stays ticked.
    const checklist = () => within(region('Utilities')).getByRole('region', { name: 'Checklist' });
    expect(within(checklist()).getByText('2 open')).toBeInTheDocument();
    const renew = () =>
      within(checklist()).getByRole('checkbox', {
        name: 'Renew the TLS certificate for the proxy',
      });
    await click(renew());
    expect(renew()).toHaveAttribute('aria-checked', 'true');
    expect(within(checklist()).getByText('1 open')).toBeInTheDocument();

    // Remove the failed backup from its detail (#578): it stays gone.
    await click(within(region('Jobs')).getByRole('link', { name: /^nightly-backup, Failed/ }));
    const detail = await drawer('nightly-backup');
    await click(within(detail).getByRole('button', { name: 'Remove…' }));
    await click(
      within(screen.getByRole('alertdialog', { name: 'Remove this backup?' })).getByRole('button', {
        name: 'Remove',
      })
    );
    expect(within(region('Jobs')).queryByText('nightly-backup')).not.toBeInTheDocument();
    expect(within(region('Jobs')).getByText('scrub-check')).toBeInTheDocument();

    expect(screen.queryByText(/Couldn.t save/)).not.toBeInTheDocument();
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

  it("each node and service carries its entity's anchor; the UPS and the jobs are rows that open them", async () => {
    await renderDemo('incident');

    expect(within(place('services/apps:jellyfin')).getByText('Jellyfin')).toBeInTheDocument();
    // A service's place is its row in the Services section (#300).
    expect(place('services/apps:jellyfin')).toHaveAttribute('data-slot', 'entity-row');
    expect(serviceGroup('App Server')).toContainElement(place('services/apps:jellyfin'));
    // A node's place is its card in the Infrastructure section (#299).
    expect(place('nodes/apps')).toHaveAttribute('data-slot', 'node-card');
    expect(place('nodes/apps')).toHaveAccessibleName('App Server');
    expect(document.querySelectorAll(`[id="${entityAnchor('nodes/apps')}"]`)).toHaveLength(1);
    // The UPS and the jobs have rows that open them (#306, #578).
    expect(document.querySelector('[data-entity="power/ups"]')).toHaveAttribute(
      'href',
      '/?entity=power/ups'
    );
    expect(
      document.querySelector('[data-entity="backups/storage:nightly-backup"]')
    ).toHaveAttribute('href', '/?entity=backups/storage:nightly-backup');
  });

  // #309: a row opens its entity's detail, over the Overview, at its URL.
  it('incident: a click on a row opens its entity’s detail over the Overview', async () => {
    await renderDemo('incident');
    const [jellyfin] = rowLinks();
    expect(jellyfin).toHaveAccessibleName('Jellyfin, Down, Service · apps');
    expect(jellyfin).toHaveAttribute('href', '/?entity=services/apps:jellyfin');

    await act(async () => {
      fireEvent.click(jellyfin);
    });
    expect(window.location.pathname + window.location.search).toBe(
      '/?entity=services/apps:jellyfin'
    );
    expect(await drawer('Jellyfin')).toBeInTheDocument();
  });

  it('incident: Enter on a row opens it too; a backup opens its backup', async () => {
    await renderDemo('incident');
    // user-event waits on a real timer between keys (Testing Library's async
    // wrapper knows only Jest's fake clock), so the keyboard runs on real ones.
    vi.useRealTimers();
    const user = userEvent.setup();
    const [, backup] = rowLinks();
    expect(backup).toHaveAccessibleName('nightly-backup, Failed, Backup · storage');
    backup.focus();
    await user.keyboard('{Enter}');
    expect(window.location.search).toBe('?entity=backups/storage:nightly-backup');
    expect(await screen.findByRole('dialog', { name: 'nightly-backup' })).toBeInTheDocument();
  });

  it('a click with a modifier key is the browser’s: the page stays where it is', async () => {
    await renderDemo('incident');
    const [jellyfin] = rowLinks();
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey']) {
      fireEvent.click(jellyfin, { [modifier]: true });
    }
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // #309: every row opens its entity, whatever the board below draws.
  it('with the Jobs section off, the backup’s row still opens its backup', async () => {
    await renderDemo('incident', {
      '/api/display-config': (config) => ({ ...config, overviewSections: { jobs: false } }),
    });
    expect(screen.queryByRole('region', { name: 'Jobs' })).toBeNull();
    const rows = within(screen.getByRole('region', { name: 'Needs attention' })).getAllByRole(
      'listitem'
    );
    expect(within(rows[1]).getByRole('link')).toHaveAttribute(
      'href',
      '/?entity=backups/storage:nightly-backup'
    );
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

  /** The model's word for a subsystem: its worst entity's, the ranked issues first. */
  function modelWord(status, subsystem) {
    const match = (e) => e.subsystem === subsystem.id && e.state === subsystem.state;
    return (status.issues.find(match) ?? status.entities.find(match)).word;
  }

  for (const scenario of ['incident', 'healthy']) {
    it(`${scenario}: a tile per subsystem the model has anything in, with its state, word, value and sub-line`, async () => {
      await renderDemo(scenario);
      const status = demoStatus(scenario);
      const configured = status.subsystems.filter((s) => s.counts.total > 0);
      const left = status.subsystems.filter((s) => s.counts.total === 0);
      // The demo sets up integrations (#518): every subsystem has a tile.
      expect(left).toEqual([]);

      const tiles = within(strip()).getAllByRole('button');
      expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(
        configured.map((s) => `${s.name}, ${modelWord(status, s)}, ${s.value}`)
      );
      configured.forEach((s, n) => {
        expect(tiles[n]).toHaveAttribute('data-state', s.state);
        expect(tiles[n]).toHaveTextContent(s.name);
        // The model's value over its sub-line (#541).
        expect(tiles[n].querySelector('[data-slot="subsystem-value"]')).toHaveTextContent(s.value);
        if (s.sub) expect(tiles[n]).toHaveAccessibleDescription(s.sub);
        expect(tiles[n]).toHaveAttribute('aria-pressed', 'false');
      });
      expect(within(strip()).getByRole('button', { name: /^Integrations/ })).toBeInTheDocument();

      // Under the status, in the Overview's status area.
      const area = document.querySelector('[data-slot="overview-status"]');
      const top = within(area).getByRole('region', {
        name: scenario === 'incident' ? 'Needs attention' : 'Status',
      });
      expect(area).toContainElement(strip());
      expect(top.compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('Nodes, clicked: the rows and the sections narrow to the nodes; clicked again, all is back', async () => {
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
    // The sections: Infrastructure alone.
    expect(sectionsDrawn()).toEqual(['Infrastructure']);

    await click(tile('Nodes'));
    expect(tile('Nodes')).toHaveAttribute('aria-pressed', 'false');
    expect(window.location.search).toBe('');
    expect(rows()).toHaveLength(2);
    expect(within(attention()).queryByText(/^Showing/)).toBeNull();
    expect(sectionsDrawn()).toEqual(SECTIONS);
  });

  it('Services: its rows, and the Services section alone; one filter at a time; Clear', async () => {
    await renderDemo('incident');
    await click(tile('Services'));
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('Jellyfin')]);
    // Its issue row opens it over the filtered Overview, the filter kept (#309).
    expect(within(rows()[0]).getByRole('link')).toHaveAttribute(
      'href',
      '/?subsystem=services&entity=services/apps:jellyfin'
    );
    expect(sectionsDrawn()).toEqual(['Services']);

    // Another tile moves the filter there: Jobs, its Backups group alone.
    await click(tile('Backups'));
    expect(tile('Services')).toHaveAttribute('aria-pressed', 'false');
    expect(tile('Backups')).toHaveAttribute('aria-pressed', 'true');
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining('nightly-backup')]);
    expect(sectionsDrawn()).toEqual(['Jobs']);
    expect(region('Jobs').querySelectorAll('[data-slot="jobs-group"]')).toHaveLength(1);

    await click(within(attention()).getByRole('button', { name: 'Clear' }));
    expect(window.location.search).toBe('');
    expect(rows()).toHaveLength(2);
    expect(sectionsDrawn()).toEqual(SECTIONS);
  });

  it('by keyboard: Space on a tile filters, Enter on it again clears', async () => {
    await renderDemo('incident');
    vi.useRealTimers();
    const user = userEvent.setup();
    tile('Power').focus();
    await user.keyboard(' ');
    expect(tile('Power')).toHaveAttribute('aria-pressed', 'true');
    expect(window.location.search).toBe('?subsystem=power');
    // The Power section alone (#306): the UPS's row.
    expect(sectionsDrawn()).toEqual(['Power']);
    expect(document.activeElement).toBe(tile('Power'));
    await user.keyboard('{Enter}');
    expect(tile('Power')).toHaveAttribute('aria-pressed', 'false');
    expect(sectionsDrawn()).toEqual(SECTIONS);
  });

  it('the filter is the URL: a link opens filtered, and Back and Forward follow it', async () => {
    await renderDemo('incident', undefined, { path: '/?subsystem=jobs', ready: 'scrub-check' });
    expect(tile('Jobs')).toHaveAttribute('aria-pressed', 'true');
    expect(sectionsDrawn()).toEqual(['Jobs']);
    expect(rows()).toHaveLength(0);

    await act(async () => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(tile('Jobs')).toHaveAttribute('aria-pressed', 'false');
    expect(sectionsDrawn()).toEqual(SECTIONS);

    await act(async () => {
      window.history.replaceState(null, '', '/?subsystem=nodes');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(tile('Nodes')).toHaveAttribute('aria-pressed', 'true');
    expect(sectionsDrawn()).toEqual(['Infrastructure']);
  });

  it.each(['/?subsystem=bogus', '/?subsystem='])(
    "a subsystem the strip doesn't show in the URL (%s): every section, and the URL drops it",
    async (path) => {
      window.history.replaceState(null, '', '/');
      const entries = window.history.length;
      await renderDemo('incident', undefined, { path });
      expect(within(strip()).queryByRole('button', { pressed: true })).toBeNull();
      expect(within(attention()).queryByText(/^Showing/)).toBeNull();
      expect(sectionsDrawn()).toEqual(SECTIONS);
      // Replaced, not a new entry: Back doesn't return to it, and it can't
      // filter the page later, once that subsystem is set up.
      expect(window.location.pathname + window.location.search).toBe('/');
      expect(window.history.length).toBe(entries);
    }
  );

  // Nothing of the subsystem is drawn: its section is switched off. It is set
  // up (the strip shows it), so the note never says it isn't: it says why.
  const note = () => document.querySelector('[data-slot="filter-empty"]');
  const NOT_SET_UP = /none yet|not set up|isn't set up/i;

  it('a filter whose section is switched off says so, and offers everything', async () => {
    await renderDemo(
      'incident',
      { '/api/display-config': (config) => ({ ...config, overviewSections: { jobs: false } }) },
      { path: '/?subsystem=backups', ready: 'Showing Backups only' }
    );
    expect(sectionsDrawn()).toEqual([]);
    expect(note()).toHaveTextContent(
      'The Jobs section is switched offSwitch it on in Settings → Appearance → Overview sections to see Backups here.'
    );
    expect(note()).not.toHaveTextContent(NOT_SET_UP);
    await click(within(note()).getByRole('button', { name: 'Show everything' }));
    expect(window.location.search).toBe('');
    expect(sectionsDrawn()).toEqual(['Infrastructure', 'Power', 'Services']);
    expect(note()).toBeNull();
  });

  // The Power section draws the status model's UPS (#549's readings): the
  // Overview never asks /api/ups for it (#306), whatever that answers.
  it.each(['hold', 'fail'])(
    'Power: the UPS’s row from the status alone, with /api/ups answering never or 503 (%s)',
    async (how) => {
      await renderDemo('incident', undefined, {
        path: '/?subsystem=power',
        ready: 'Showing Power only',
        [how]: ['/api/ups'],
      });
      expect(tile('Power')).toHaveAttribute('aria-pressed', 'true');
      expect(sectionsDrawn()).toEqual(['Power']);
      expect(
        within(region('Power')).getByRole('link', { name: 'Example UPS 1500VA, On mains' })
      ).toBeInTheDocument();
      expect(note()).toBeNull();
      expect(requests).not.toContain('GET /api/ups');
    }
  );

  it('Services while /api/services is out: the section loading, no note', async () => {
    await renderDemo('incident', undefined, {
      path: '/?subsystem=services',
      ready: 'Showing Services only',
      hold: ['/api/services'],
    });
    expect(servicesSection()).toHaveAttribute('aria-busy', 'true');
    expect(within(servicesSection()).getByText('The services are loading')).toBeTruthy();
    expect(note()).toBeNull();
  });
});

// The Infrastructure section (#299, spec §8 item 3): first under the strip, a
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
    it(`${scenario}: a card per node the model has, in its state, above the other sections`, async () => {
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
      // Above the other sections.
      expect(sectionsDrawn()[0]).toBe('Infrastructure');
    });
  }

  it('the incident: the NAS at 94.6 % disk reads as a warning, 94, and its row opens it', async () => {
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
    expect(row).toHaveAttribute('href', '/?entity=nodes/storage');
    // The card opens it too (#309).
    expect(within(nas).getByRole('link', { name: 'Storage' })).toHaveAttribute(
      'href',
      '/?entity=nodes/storage'
    );
    await click(row);
    expect(await drawer('Storage')).toBeInTheDocument();
  });

  it('Nodes: the section stays; another filter hides it, and the node has no other place', async () => {
    await renderDemo('incident');
    await click(tile('Nodes'));
    expect(section()).toBeInTheDocument();
    expect(place('nodes/apps')).toBe(card('App Server'));

    // Services: the section is the Nodes subsystem's, so it goes; each
    // service's row is in the Services section (#300).
    await click(tile('Services'));
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();
    expect(place('nodes/apps')).toBeNull();
    expect(place('services/apps:jellyfin')).toHaveAttribute('data-slot', 'entity-row');

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
// The Services section (#300, spec §8 item 4): under Infrastructure, every
// service the model has, one list grouped by node or by custom group; each
// row's state, word and reason the model's, its latency /api/services'.
describe("the demo's Services section", () => {
  const strip = () => screen.getByRole('region', { name: 'Subsystems' });
  const tile = (name) => within(strip()).getByRole('button', { name: new RegExp(`^${name},`) });
  const place = (entityId) => document.getElementById(entityAnchor(entityId));
  const click = async (el) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };
  const grouping = () =>
    within(servicesSection()).getByRole('radiogroup', { name: 'Group services by' });
  const groupTitles = () =>
    within(servicesSection())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
  const MEDIA = { id: 'media', title: 'Media', containers: ['apps:jellyfin', 'photoprism'] };

  for (const scenario of ['incident', 'healthy']) {
    it(`${scenario}: a row per service the model has, in its state, grouped by node, under Infrastructure`, async () => {
      await renderDemo(scenario);
      const status = demoStatus(scenario);
      const entities = status.entities.filter((e) => e.subsystem === 'services');
      const services = demoResponse({ method: 'GET', path: '/api/services', query: {}, scenario });
      const rows = serviceRowEls();
      expect(rows.map((r) => r.dataset.entity).sort()).toEqual(entities.map((e) => e.id).sort());
      for (const row of rows) {
        const e = entities.find((x) => x.id === row.dataset.entity);
        expect(row, e.id).toHaveAttribute('data-state', e.state);
        expect(row.id).toBe(entityAnchor(e.id));
        // A link to the service (#309), named by its word.
        expect(row).toHaveAccessibleName(`${e.name}, ${e.word}`);
        expect(row).toHaveAttribute('href', `/?entity=${e.id}`);
        // Healthy rows are muted; a failing one is not.
        if (e.state === 'ok') expect(row).toHaveAttribute('data-muted', '');
        else expect(row).not.toHaveAttribute('data-muted');
      }
      // A group per node, in services.yaml's order.
      expect(groupTitles()).toEqual(Object.values(services.body.nodes).map((n) => n.display_name));
      // The last section, under Infrastructure.
      const infra = screen.getByRole('region', { name: 'Infrastructure' });
      expect(
        infra.compareDocumentPosition(servicesSection()) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(sectionsDrawn().at(-1)).toBe('Services');
      const down = entities.filter((e) => e.state === 'crit').length;
      expect(within(servicesSection()).getByText(/^\d+ monitored/)).toHaveTextContent(
        `${rows.length} monitored · ${down ? `${down} down` : 'all up'}`
      );
    });
  }

  // #518: the demo serves its integrations, so a service row that has one shows
  // its headline metric (servicesView.js headlineMetric) where the model's
  // reason would be; a down row shows the reason, and a service with no
  // integration shows neither.
  for (const scenario of ['incident', 'healthy']) {
    it(`${scenario}: a row with an integration shows its headline metric (#518)`, async () => {
      await renderDemo(scenario);
      const answer = (path) => demoResponse({ method: 'GET', path, query: {}, scenario }).body;
      const integrations = answer('/api/integrations');
      const claims = integrationClaims(integrations, answer('/api/services'));
      const entities = demoStatus(scenario).entities;
      expect(Object.keys(claims).length).toBeGreaterThanOrEqual(3);
      const bare = serviceRowEls().filter((r) => !claims[r.dataset.entity.replace(/^services\//, '')]);
      expect(bare.length, 'some service has no integration').toBeGreaterThan(0);

      for (const [uid, key] of Object.entries(claims)) {
        const id = `services/${uid}`;
        const row = place(id);
        expect(row, id).not.toBeNull();
        const metric = headlineMetric(appEntryOf(integrations[key]));
        expect(metric, id).toBeTruthy();
        if (entities.find((e) => e.id === id).state === 'ok') {
          expect(row, id).toHaveTextContent(metric);
        } else {
          expect(row, id).not.toHaveTextContent(metric);
        }
      }
    });
  }

  it("the incident: Jellyfin's row, worst first in its group, opens its detail (#309)", async () => {
    await renderDemo('incident');
    const row = place('services/apps:jellyfin');
    expect(row).toHaveAttribute('data-state', 'crit');
    // The worst first in its group.
    expect(within(serviceGroup('App Server')).getAllByRole('listitem')[0]).toContainElement(row);
    await click(row);
    expect(window.location.search).toBe('?entity=services/apps:jellyfin');
    expect(await drawer('Jellyfin')).toBeInTheDocument();
  });

  it('without a custom group: Group is offered but disabled, with a link to where groups are set', async () => {
    await renderDemo('incident');
    expect(within(grouping()).getByRole('radio', { name: 'Node' })).toBeChecked();
    expect(within(grouping()).getByRole('radio', { name: 'Group' })).toBeDisabled();
    const link = within(servicesSection()).getByRole('link', {
      name: /Settings → Nodes & Services/,
    });
    expect(link).toHaveAttribute('href', '/settings/nodes#custom-groups');
    await click(link);
    expect(window.location.pathname).toBe('/settings/nodes');
    expect(window.location.hash).toBe('#custom-groups');
  });

  it('by custom group: the choice kept in this browser, the node beside each name', async () => {
    const edit = {
      '/api/display-config': (config) => ({ ...config, customGroups: [MEDIA] }),
    };
    await renderDemo('incident', edit);
    expect(within(grouping()).getByRole('radio', { name: 'Node' })).toBeChecked();
    await click(within(grouping()).getByRole('radio', { name: 'Group' }));
    expect(localStorage.getItem(GROUPING_PREF)).toBe('group');
    expect(servicesSection()).toHaveAttribute('data-grouping', 'group');
    expect(groupTitles()).toEqual(['Media', 'Not in a group']);
    const media = within(serviceGroup('Media')).getAllByRole('listitem');
    expect(media.map((li) => li.querySelector('[data-slot="entity-name"]').textContent)).toEqual([
      'Jellyfin',
      'Photoprism',
    ]);
    expect(media[0].querySelector('[data-slot="entity-where"]')).toHaveTextContent('App Server');
    // Its row is still its place.
    expect(place('services/apps:jellyfin')).toBe(
      media[0].querySelector('[data-slot="entity-row"]')
    );
  });

  it('opens grouped as this browser kept', async () => {
    localStorage.setItem(GROUPING_PREF, 'group');
    await renderDemo('incident', {
      '/api/display-config': (config) => ({ ...config, customGroups: [MEDIA] }),
    });
    expect(within(grouping()).getByRole('radio', { name: 'Group' })).toBeChecked();
    expect(groupTitles()[0]).toBe('Media');
  });

  it('kept by node with no custom group, whatever this browser kept', async () => {
    localStorage.setItem(GROUPING_PREF, 'group');
    await renderDemo('incident');
    expect(servicesSection()).toHaveAttribute('data-grouping', 'node');
    expect(groupTitles()).toContain('App Server');
  });

  it('Nodes hides it; Services keeps it alone', async () => {
    await renderDemo('incident');
    await click(tile('Nodes'));
    expect(screen.queryByRole('region', { name: 'Services' })).toBeNull();
    await click(tile('Services'));
    expect(servicesSection()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();
  });

  it('with no service in the model: no section', async () => {
    const empty = (status) => ({
      ...status,
      entities: status.entities.filter((e) => e.subsystem !== 'services'),
      issues: status.issues.filter((e) => e.subsystem !== 'services'),
    });
    await renderDemo('healthy', { '/api/status': empty });
    expect(screen.getByRole('region', { name: 'Infrastructure' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Services' })).toBeNull();
  });
});

describe('No signal: a stale status never looks current', () => {
  // The header's status: its link, and the live region that announces it.
  const header = () => screen.getByRole('banner').querySelector('[data-slot="header-status"]');
  const area = () => document.querySelector('[data-slot="overview-status"]');
  const attention = () => within(area()).getByRole('region', { name: 'Needs attention' });
  const strip = () => within(area()).getByRole('region', { name: 'Subsystems' });
  const section = () => screen.getByRole('region', { name: 'Infrastructure' });
  const places = () => [header(), area(), section(), servicesSection()];

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
      services: age(within(servicesSection()).getByText(/^\d+ monitored/).textContent),
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
      // The strip: every tile no signal, its count and sub-line kept as they
      // read fresh; the heading above says how old they are, no tile does.
      for (const t of within(strip()).getAllByRole('button')) {
        expect(t).toHaveAttribute('data-state', 'unknown');
        expect(t).toHaveTextContent(/\d+ \/ \d+|On mains|On battery|\d/);
        expect(t).not.toHaveAccessibleDescription(/last known|ago/i);
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
      // Services (#300): every row no signal, Jellyfin's last known reason kept.
      const services = serviceRowEls();
      expect(services.length).toBeGreaterThan(10);
      for (const row of services) expect(row).toHaveAttribute('data-state', 'unknown');
      expect(
        within(servicesSection()).getByText(
          `${services.length} monitored · No signal · last known 30 s ago`
        )
      ).toBeInTheDocument();
      const jellyfin = services.find((r) => r.dataset.entity === 'services/apps:jellyfin');
      expect(
        within(jellyfin).getByText('Kuma: down').closest('[data-slot="entity-detail"]')
      ).toHaveClass('text-unknown-fg');

      // No lamp is named by a level word: each is named for what it draws, or
      // is decorative beside the words "No signal" (in them, or in the name of
      // the link it is in).
      for (const place of places())
        for (const lamp of place.querySelectorAll('[data-slot="status-lamp"]')) {
          if (lamp.getAttribute('aria-hidden') === 'true') {
            const link = lamp.closest('a[aria-label]');
            if (link) expect(link).toHaveAccessibleName(/No signal/);
            else expect(lamp.parentElement).toHaveTextContent(/No signal/);
          } else expect(lamp).toHaveAccessibleName('No signal');
        }
      // A tile or a row says it before its last word.
      for (const t of within(strip()).getAllByRole('button'))
        expect(t).toHaveAccessibleName(/^[^,]+, No signal, /);
      for (const row of rows)
        expect(within(row).getByRole('link')).toHaveAccessibleName(/^[^,]+, No signal, /);
    });
  }

  // #480 review: a hidden tab or a sleeping laptop asks nothing, so the poll's
  // reach is still 'ok' when the tab is shown again, hours on.
  it('a tab shown again hours later: no level colour in its first render, before any answer; the answer brings them back', async () => {
    await renderNasIncident();
    expect(places().flatMap(levels).join('\n')).toMatch(/crit/);
    const alerts = () => screen.getAllByRole('link', { name: /^Alerts\b/ });
    expect(alerts().some((a) => /issues?$/.test(a.getAttribute('aria-label') ?? ''))).toBe(true);
    setHidden(true);
    // Three hours, and no timer run, as a laptop asleep.
    vi.setSystemTime(Date.now() + 3 * 3_600_000);
    const asked = requests.filter((r) => r === 'GET /api/status').length;
    setHidden(false);
    // Asked at once, not yet answered: grey, saying how old.
    expect(requests.filter((r) => r === 'GET /api/status').length).toBe(asked + 1);
    for (const place of places()) expect(levels(place), place.dataset.slot).toEqual([]);
    expect(within(header()).getByRole('link')).toHaveAccessibleName(
      'No signal: last known 3 h ago: Critical · 2 critical, 1 warning'
    );
    expect(within(attention()).getByText("JagHelm's status is out of date")).toBeInTheDocument();
    expect(nas()).toHaveAttribute('data-state', 'unknown');
    // No Alerts badge, with an old count in an old colour, either.
    for (const a of alerts()) expect(a).not.toHaveAccessibleName(/issue/);
    // The section's own readings are as old, and it says so with the header,
    // by the same rule on the same clock (#559).
    expect(within(section()).getByText("Node readings aren't updating")).toBeInTheDocument();
    expect(within(section()).getByText('Updated 3h ago')).toBeInTheDocument();

    // The answers: every colour back, and the note gone, together.
    await advance(0);
    expect(within(header()).getByRole('link')).toHaveAttribute('data-state', 'crit');
    expect(attention()).toHaveAttribute('data-state', 'crit');
    expect(nas()).toHaveAttribute('data-state', 'warn');
    expect(screen.queryByText(/last known/i)).toBeNull();
    expect(screen.queryByText("Node readings aren't updating")).toBeNull();
  });

  it('the age keeps moving, and every place reads the same one', async () => {
    await renderNasIncident();
    statusAnswer = 'down';
    await untilTheNextPoll();
    // No tile says an age (#541): the header and the panel say it, once.
    const tiles = within(strip()).getAllByRole('button').length;
    expect(ages()).toEqual({
      header: '30 s ago',
      panel: '30 s ago',
      tiles: Array(tiles).fill(null),
      section: '30 s ago',
      services: '30 s ago',
    });
    for (const [ms, said] of [
      [17_000, '47 s ago'],
      [4 * 60_000, '4 min ago'],
    ]) {
      await advance(ms);
      expect(ages()).toEqual({
        header: said,
        panel: said,
        tiles: Array(tiles).fill(null),
        section: said,
        services: said,
      });
    }
    // The header's own "Updated" says the same age.
    expect(within(screen.getByRole('banner')).getByText('Updated 4 min ago')).toBeInTheDocument();
    // Its live region said No signal once, and none of the ages since.
    expect(within(header()).getByRole('status')).toHaveTextContent(
      "No signal: Can't reach JagHelm"
    );
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
