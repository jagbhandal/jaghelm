import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import DashboardView from './DashboardView';
import { useDashboardData } from './useDashboardData';
import { defaultConfig } from '../../defaultConfig.js';
import { LAYOUT_VERSION } from './layouts';
import { RAIL_WIDTH } from '@ui/app-shell';

// What the board renders on a fresh install and on an existing one (#272).
//
// The data hook is mocked so each test sets exactly what the endpoints said.
// HelmGrid is replaced by a plain container that renders its children and
// exposes the layout it was handed: jsdom has no layout, so the real grid
// renders nothing until it measures a width.

vi.mock('./useDashboardData', () => ({
  useDashboardData: vi.fn(),
  pollPeriodMs: (_key, ms) => ms,
}));

vi.mock('../../components/HelmGrid', () => ({
  // A drag's save, as HelmGrid hands it on: every breakpoint as drawn.
  default: ({ children, layouts, onLayoutChange }) => (
    <div data-testid="grid" data-layouts={JSON.stringify(layouts)}>
      <span data-testid="drag-save" onClick={() => onLayoutChange?.(layouts.lg, layouts)} />
      {children}
    </div>
  ),
}));

// TodoCard loads /api/todos and needs the toast context; neither is under test.
vi.mock('../../components/TodoCard', () => ({
  default: () => <div>Checklist panel</div>,
}));

const source = (overrides = {}) => ({
  error: null,
  lastSuccessMs: null,
  watchedSinceMs: null,
  ...overrides,
});

function boardData(overrides = {}) {
  return {
    serviceData: { nodes: {} },
    ups: null,
    commits: [],
    cronJobs: [],
    integrationData: {},
    history: {},
    servicesLoaded: true,
    sources: {
      services: source(),
      ups: source(),
      commits: source(),
      cron: source(),
      integrations: source(),
    },
    healthNow: Date.now(),
    overallHealth: 'up',
    retry: vi.fn(),
    ...overrides,
  };
}

// The config a fresh install runs with: /api/display-config answered null, so
// App keeps its built-in defaults (no saved layout, no section settings).
function freshConfig(overrides = {}) {
  return { ...defaultConfig(), ...overrides };
}

const node = (name) => ({ display_name: name, services: [], metrics: {} });

// /api/ups bodies. No UPS: Prometheus answered and has never seen one.
const NO_UPS = {
  status: null,
  charge: null,
  runtime: null,
  load: null,
  ok: true,
  configured: false,
  model: null,
};
const UPS_ONLINE = {
  status: 1,
  charge: 100,
  runtime: 1800,
  load: 20,
  ok: true,
  configured: true,
  model: 'Example UPS 900',
};
// Set up, its exporter quiet: no readings, but seen within the last 7 days.
const UPS_DARK = { ...NO_UPS, configured: true, model: 'Example UPS 900' };
// Prometheus failed, so whether there is a UPS is not known.
const UPS_UNKNOWN = { ...NO_UPS, ok: false, configured: null };

// /api/gitea/activity without GITEA_URL.
const NO_GITEA = { configured: false };

// Gitea set up and unreachable: /api/gitea/activity answers 502, so commits
// stay at their [] seed.
const GITEA_DOWN = (sources) => ({
  ...sources,
  commits: source({ error: 'HTTP 502' }),
});

// Sources, the default ones with `overrides` on top.
const sourcesWith = (overrides) => ({ ...boardData().sources, ...overrides });
const answered = (overrides = {}) => source({ lastSuccessMs: Date.now(), ...overrides });

function renderBoard(config, data) {
  useDashboardData.mockReturnValue(data);
  const utils = render(
    <ConfigProvider config={config} setConfig={vi.fn()}>
      <DashboardView refreshKey={0} tick={0} active onHealth={vi.fn()} onOpenSettings={vi.fn()} />
    </ConfigProvider>
  );
  const rerenderWith = (nextData) => {
    useDashboardData.mockReturnValue(nextData);
    utils.rerender(
      <ConfigProvider config={config} setConfig={vi.fn()}>
        <DashboardView refreshKey={0} tick={0} active onHealth={vi.fn()} onOpenSettings={vi.fn()} />
      </ConfigProvider>
    );
  };
  return { ...utils, rerenderWith };
}

// The panel whose title is `title`, to look inside it (the page-level live
// region repeats every banner message, so a page-wide query finds two).
const panel = (title) => screen.getByText(title).closest('.glass-card');

const gridLayouts = () => JSON.parse(screen.getByTestId('grid').getAttribute('data-layouts'));
// The page-level live region (dnd-kit adds an assertive one of its own).
const liveRegion = () => {
  const polite = screen
    .getAllByRole('status')
    .filter((el) => el.getAttribute('aria-live') === 'polite');
  expect(polite).toHaveLength(1);
  return polite[0];
};
const ids = (items) => items.map((it) => it.i);

beforeEach(() => {
  useDashboardData.mockReset();
});

describe('DashboardView on a fresh install', () => {
  it('shows the empty state, and no ghost node panel, when display-config is null', () => {
    renderBoard(freshConfig(), boardData());

    expect(screen.getByText('Connect your first node')).toBeInTheDocument();
    expect(screen.queryByText(/Loading gateway/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading production/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading staging/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('shows the loading skeleton, not ghost node panels, while /api/services is in flight', () => {
    renderBoard(freshConfig(), boardData({ servicesLoaded: false }));

    expect(screen.getByLabelText('Loading dashboard')).toBeInTheDocument();
    expect(screen.queryByText(/Loading gateway/i)).not.toBeInTheDocument();
  });

  it('hides the UPS and Pipeline panels when the server says neither is set up, and announces neither', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        ups: NO_UPS,
        commits: NO_GITEA,
        // The latest polls failed; the answers before them still hold.
        sources: sourcesWith({
          ups: answered({ error: 'HTTP 502' }),
          commits: answered({ error: 'HTTP 502' }),
        }),
      })
    );

    expect(screen.getByText('Proxmox')).toBeInTheDocument();
    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
    // Not in the layout either, so they hold no empty slot in the grid.
    const layouts = gridLayouts();
    for (const bp of Object.keys(layouts)) {
      expect(ids(layouts[bp])).not.toContain('ups');
      expect(ids(layouts[bp])).not.toContain('pipeline');
    }
    // Nothing on the board shows them, so the live region doesn't announce them.
    expect(liveRegion()).not.toHaveTextContent(/Gitea/);
    expect(liveRegion()).not.toHaveTextContent(/UPS/);
  });

  it('shows a UPS that is set up but dark at load: "Unknown", with its model as the subtitle', () => {
    renderBoard(
      freshConfig(),
      boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, ups: UPS_DARK })
    );

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(within(panel('UPS Power')).getByText('Example UPS 900')).toBeInTheDocument();
  });

  it('shows the UPS panel when set up, keeps it while Prometheus fails, and hides it when the server says it is gone', () => {
    const data = boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, ups: UPS_ONLINE });
    const { rerenderWith } = renderBoard(freshConfig(), data);

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();

    rerenderWith({ ...data, ups: UPS_UNKNOWN });
    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();

    rerenderWith({ ...data, ups: NO_UPS });
    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
  });

  it('shows a Gitea that fails at load (502), with its banner, and announces it', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        sources: GITEA_DOWN(boardData().sources),
      })
    );

    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(
      within(panel('Pipeline Activity')).getByText(/Pipeline activity unavailable/)
    ).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent(/Gitea unreachable/);
  });

  it('shows the Pipeline panel once Gitea answers, and keeps it with its banner when Gitea fails', () => {
    const commits = [{ repo: 'homelab', commits: [{ sha: 'abc1234', message: 'fix', date: '' }] }];
    const data = boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, commits });
    const { rerenderWith } = renderBoard(freshConfig(), data);

    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();

    rerenderWith({ ...data, sources: GITEA_DOWN(data.sources) });

    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(
      within(panel('Pipeline Activity')).getByText(/Pipeline activity unavailable/)
    ).toBeInTheDocument();
  });

  it('shows the Pipeline panel when Gitea answers with no commits', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        commits: [],
        sources: sourcesWith({ commits: answered() }),
      })
    );

    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(screen.getByText('No recent commits')).toBeInTheDocument();
  });

  it('shows neither panel before the server answers, nor for a demo-style {} answer', () => {
    const data = boardData({ serviceData: { nodes: { pve1: node('Proxmox') } } });
    const { rerenderWith } = renderBoard(freshConfig(), data);

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();

    rerenderWith({ ...data, ups: {}, commits: {}, sources: sourcesWith({ commits: answered() }) });

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
  });

  it('does not announce a source whose panel is switched off in Settings', () => {
    renderBoard(
      freshConfig({ sections: { pipeline: { visible: false } } }),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        sources: GITEA_DOWN(boardData().sources),
      })
    );

    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
    expect(liveRegion()).not.toHaveTextContent(/Gitea/);
  });

  it('titles the UPS panel with the subtitle set in Settings, then the model, then "Battery backup"', () => {
    const nodes = { pve1: node('Proxmox') };
    const { unmount } = renderBoard(
      freshConfig({ sections: { ups: { subtitle: 'Rack UPS' } } }),
      boardData({ serviceData: { nodes }, ups: UPS_ONLINE })
    );
    expect(within(panel('UPS Power')).getByText('Rack UPS')).toBeInTheDocument();
    unmount();

    renderBoard(
      freshConfig(),
      boardData({ serviceData: { nodes }, ups: { ...UPS_ONLINE, model: null } })
    );
    expect(within(panel('UPS Power')).getByText('Battery backup')).toBeInTheDocument();
  });
});

describe('DashboardView without a saved layout (#248)', () => {
  // The lg layout's rows, top to bottom: the panel ids at each y, left to right.
  const lgRows = () => {
    const byY = new Map();
    for (const it of [...gridLayouts().lg].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!byY.has(it.y)) byY.set(it.y, []);
      byY.get(it.y).push(it.i);
    }
    return [...byY.values()];
  };

  it('places the discovered nodes first, side by side, then the panels', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: {
          nodes: { edge: node('Edge'), apps: node('Apps'), storage: node('Storage') },
        },
        ups: NO_UPS,
        commits: NO_GITEA,
        sources: sourcesWith({ commits: answered() }),
      })
    );

    expect(lgRows()).toEqual([
      ['node-edge', 'node-apps', 'node-storage'],
      ['cron-jobs', 'todos'],
      ['quicklaunch'],
    ]);
    expect(screen.queryByText(/Loading /)).not.toBeInTheDocument();
  });

  it('pairs the panels by height once the UPS and Pipeline sources are set up', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { edge: node('Edge'), apps: node('Apps') } },
        ups: UPS_ONLINE,
        commits: [],
        sources: sourcesWith({ commits: answered() }),
      })
    );

    expect(lgRows()).toEqual([
      ['node-edge', 'node-apps'],
      ['pipeline', 'cron-jobs'],
      ['ups', 'todos'],
      ['quicklaunch'],
    ]);
  });

  it('holds no slot for a panel switched off in Settings', () => {
    renderBoard(
      freshConfig({ sections: { todos: { visible: false } } }),
      boardData({ serviceData: { nodes: { edge: node('Edge') } } })
    );

    expect(lgRows()).toEqual([['node-edge'], ['cron-jobs'], ['quicklaunch']]);
    for (const items of Object.values(gridLayouts())) expect(ids(items)).not.toContain('todos');
  });
});

describe('DashboardView on an existing install', () => {
  // A layout saved before #272, naming the panels the old defaults shipped.
  // Saved since #299 (version 2), so its node panels' heights are its own.
  const SAVED = {
    version: 2,
    lg: [
      { i: 'node-gateway', x: 0, y: 0, w: 24, h: 7, minW: 4, minH: 3 },
      { i: 'node-production', x: 0, y: 7, w: 24, h: 7, minW: 4, minH: 3 },
      { i: 'node-staging', x: 0, y: 14, w: 12, h: 6, minW: 4, minH: 3 },
      { i: 'ups', x: 12, y: 14, w: 12, h: 5, minW: 4, minH: 3 },
      { i: 'pipeline', x: 0, y: 20, w: 16, h: 5, minW: 4, minH: 3 },
      { i: 'todos', x: 16, y: 20, w: 8, h: 5, minW: 4, minH: 3 },
      { i: 'cron-jobs', x: 0, y: 25, w: 24, h: 7, minW: 4, minH: 3 },
      { i: 'quicklaunch', x: 0, y: 32, w: 24, h: 4, minW: 4, minH: 2 },
    ],
  };
  const NODES = {
    gateway: node('Gateway'),
    production: node('Production'),
    staging: node('Staging'),
  };

  it('renders the node panels a saved layout names, at their saved positions', () => {
    // Gitea hasn't answered yet: its panel waits, keeping its place.
    renderBoard(
      freshConfig({ gridLayout: SAVED }),
      boardData({ serviceData: { nodes: NODES }, ups: UPS_ONLINE })
    );

    expect(screen.getByText('Gateway')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
    expect(screen.queryByText('Connect your first node')).not.toBeInTheDocument();
    expect(gridLayouts().lg).toEqual(SAVED.lg);
  });

  it('keeps the UPS and Pipeline panels a saved layout names while they are down, showing their down state', () => {
    renderBoard(
      freshConfig({ gridLayout: SAVED }),
      boardData({
        serviceData: { nodes: NODES },
        ups: UPS_DARK,
        sources: GITEA_DOWN(boardData().sources),
      })
    );

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(
      within(panel('Pipeline Activity')).getByText(/Pipeline activity unavailable/)
    ).toBeInTheDocument();
    expect(gridLayouts().lg).toEqual(SAVED.lg);
  });

  it('hides the UPS and Pipeline panels the server says are not set up, even when the saved layout names them', () => {
    renderBoard(
      freshConfig({ gridLayout: SAVED }),
      boardData({
        serviceData: { nodes: NODES },
        ups: NO_UPS,
        commits: NO_GITEA,
        sources: sourcesWith({ commits: answered() }),
      })
    );

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
    // Dropped from the layout, so the space they held is free; the rest is as saved.
    expect(gridLayouts().lg).toEqual(
      SAVED.lg.filter((it) => it.i !== 'ups' && it.i !== 'pipeline')
    );
  });

  it('leaves a saved layout untouched when it names no UPS or Pipeline panel and neither is set up', () => {
    const saved = {
      version: 2,
      lg: SAVED.lg.filter((it) => it.i !== 'ups' && it.i !== 'pipeline'),
    };
    renderBoard(
      freshConfig({ gridLayout: saved }),
      boardData({
        serviceData: { nodes: NODES },
        ups: NO_UPS,
        commits: NO_GITEA,
        sources: sourcesWith({ commits: answered() }),
      })
    );

    expect(gridLayouts().lg).toEqual(saved.lg);
    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
  });

  it('still hides a panel switched off in Settings, whatever its source says', () => {
    renderBoard(
      freshConfig({ gridLayout: SAVED, sections: { ups: { visible: false } } }),
      boardData({ serviceData: { nodes: NODES }, ups: UPS_ONLINE })
    );

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
  });

  it('does not show a panel switched on in Settings whose source is not set up', () => {
    renderBoard(
      freshConfig({ gridLayout: SAVED, sections: { ups: { visible: true } } }),
      boardData({ serviceData: { nodes: NODES }, ups: NO_UPS })
    );

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
  });
});

// #299: node panels lost their reading tiles, so a layout saved before kept
// each at a height with nothing in it (HelmGrid grows a panel, never shrinks
// one). Brought up to LAYOUT_VERSION once, and saved with its version.
describe('a layout saved before #299', () => {
  // Saved with the reading tiles: node panels 8 and 12 rows tall.
  const OLD = {
    lg: [
      { i: 'node-edge', x: 0, y: 0, w: 12, h: 8, minW: 4, minH: 3 },
      { i: 'node-apps', x: 12, y: 0, w: 12, h: 12, minW: 4, minH: 3 },
      { i: 'cron-jobs', x: 0, y: 12, w: 12, h: 7, minW: 4, minH: 3 },
      { i: 'todos', x: 12, y: 12, w: 12, h: 7, minW: 4, minH: 3 },
    ],
  };
  const NODES = { edge: node('Edge'), apps: node('Apps') };

  /** The board under a config that changes as the board sets it. */
  function Live({ initial, onConfig }) {
    const [config, setConfig] = useState(initial);
    onConfig(config);
    return (
      <ConfigProvider config={config} setConfig={setConfig}>
        <DashboardView refreshKey={0} tick={0} active onOpenSettings={vi.fn()} />
      </ConfigProvider>
    );
  }

  function renderLive(gridLayout) {
    useDashboardData.mockReturnValue(boardData({ serviceData: { nodes: NODES }, ups: NO_UPS }));
    const seen = [];
    render(<Live initial={freshConfig({ gridLayout })} onConfig={(c) => seen.push(c)} />);
    return seen;
  }
  const byId = (items) => Object.fromEntries(items.map((it) => [it.i, it]));

  it('is drawn and saved once with its node panels at their minimum, everything moved up', () => {
    const seen = renderLive(OLD);
    const saved = seen.at(-1).gridLayout;
    expect(saved.version).toBe(LAYOUT_VERSION);
    const lg = byId(saved.lg);
    // HelmGrid grows each node panel back to its content from there.
    expect([lg['node-edge'].h, lg['node-apps'].h]).toEqual([3, 3]);
    expect([lg['cron-jobs'].y, lg.todos.y]).toEqual([3, 3]);
    expect(byId(gridLayouts().lg)['node-apps'].h).toBe(3);
    // Saved once: one change to the layout, not one per render.
    expect(new Set(seen.map((c) => c.gridLayout)).size).toBe(2);
  });

  it('never again: a height set after it is the user’s, and stays', () => {
    const mine = {
      version: LAYOUT_VERSION,
      lg: OLD.lg.map((it) => (it.i === 'node-apps' ? { ...it, h: 10 } : it)),
    };
    const seen = renderLive(mine);
    expect(seen.every((c) => c.gridLayout === mine)).toBe(true);
    expect(byId(gridLayouts().lg)['node-apps'].h).toBe(10);
  });

  it('a drag saves the layout with its version, so the step never runs on it', () => {
    const seen = renderLive({ version: LAYOUT_VERSION, lg: OLD.lg });
    act(() => {
      fireEvent.click(screen.getByTestId('drag-save'));
    });
    const saved = seen.at(-1).gridLayout;
    expect(saved.version).toBe(LAYOUT_VERSION);
    expect(byId(saved.lg)['node-apps'].h).toBe(12);
  });
});

// From 1440px the Overview's rail draws Quick Launch, Pipeline and the
// Checklist (#301), so the board leaves its own out: one of each on screen.
describe('DashboardView beside the utilities rail', () => {
  function wide(on) {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: on && query === RAIL_WIDTH,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  const commits = [{ repo: 'homelab', commits: [{ sha: 'abc1234', message: 'fix', date: '' }] }];
  const config = () =>
    freshConfig({ links: { personal: [{ name: 'Nextcloud', url: 'https://cloud.example/' }] } });
  const data = () => boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, commits });

  it('narrower than 1440px, the board has all three', () => {
    wide(false);
    renderBoard(config(), data());
    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(screen.getByText('Checklist panel')).toBeInTheDocument();
    expect(screen.getByText('Quick Launch')).toBeInTheDocument();
    expect(ids(gridLayouts().lg)).toEqual(
      expect.arrayContaining(['pipeline', 'todos', 'quicklaunch'])
    );
  });

  it('from 1440px, the board draws none of them, and holds no slot for them', () => {
    wide(true);
    renderBoard(config(), data());
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Checklist panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick Launch')).not.toBeInTheDocument();
    // The others stay.
    expect(screen.getByText('Scheduled Jobs')).toBeInTheDocument();
    for (const key of ['pipeline', 'todos', 'quicklaunch'])
      expect(ids(gridLayouts().lg)).not.toContain(key);
  });
});

describe('DashboardView before the first status (#243)', () => {
  // The header's poll, in each of its states before and after its first answer.
  const renderAt = (reach) =>
    render(
      <ConfigProvider config={freshConfig()} setConfig={vi.fn()}>
        <DashboardView refreshKey={0} tick={0} active reach={reach} onOpenSettings={vi.fn()} />
      </ConfigProvider>
    );

  it('draws nothing under the status until the poll has its first answer', () => {
    useDashboardData.mockReturnValue(
      boardData({ serviceData: { nodes: { pve1: node('Proxmox') } } })
    );
    const { container, rerender } = renderAt('loading');
    // The board's own element stays, empty, so its width is known.
    expect(container.querySelector('.dashboard-content')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();

    for (const reach of ['ok', 'down', 'waiting']) {
      rerender(
        <ConfigProvider config={freshConfig()} setConfig={vi.fn()}>
          <DashboardView refreshKey={0} tick={0} active reach={reach} onOpenSettings={vi.fn()} />
        </ConfigProvider>
      );
      expect(screen.getByTestId('grid'), reach).toBeInTheDocument();
    }
  });

  it('loads its data meanwhile', () => {
    useDashboardData.mockReturnValue(boardData());
    renderAt('loading');
    expect(useDashboardData).toHaveBeenCalled();
  });
});

describe('DashboardView stale notes (#545)', () => {
  // The hook reads each source's last answer at `healthNow`; judged at the
  // later wall clock instead, a source that answered on time reads stale.
  it("judges each source at the hook's healthNow, the clock its answers were read on", () => {
    const healthNow = Date.now() - 3000;
    const data = boardData({
      serviceData: { nodes: { pve1: node('Proxmox') } },
      ups: UPS_ONLINE,
      healthNow,
      // 2 polls before healthNow at a 2 s interval: due, not missed.
      sources: sourcesWith({ ups: source({ lastSuccessMs: healthNow - 4000 }) }),
    });
    const { rerenderWith } = renderBoard(freshConfig({ refreshInterval: 2 }), data);
    expect(within(panel('UPS Power')).queryByText(/updated/)).not.toBeInTheDocument();

    // One more second of silence at the hook's clock: 2 polls missed.
    rerenderWith({
      ...data,
      sources: sourcesWith({ ups: source({ lastSuccessMs: healthNow - 5000 }) }),
    });
    expect(within(panel('UPS Power')).getByText('updated 5s ago')).toBeInTheDocument();
  });
});
