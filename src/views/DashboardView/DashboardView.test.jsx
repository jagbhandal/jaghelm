import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import DashboardView from './DashboardView';
import { useDashboardData } from './useDashboardData';
import { defaultConfig } from '../../defaultConfig.js';

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
  default: ({ children, layouts }) => (
    <div data-testid="grid" data-layouts={JSON.stringify(layouts)}>
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
        serviceData: { nodes: { edge: node('Edge'), apps: node('Apps'), storage: node('Storage') } },
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

  it('places the UPS and Pipeline panels beside each other once their sources are set up', () => {
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
      ['ups', 'pipeline'],
      ['cron-jobs', 'todos'],
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
  const SAVED = {
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
