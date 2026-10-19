import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigProvider } from '../../context/ConfigContext.jsx';
import DashboardView from './DashboardView';
import { useDashboardData } from './useDashboardData';

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
  return {
    title: 'JAGHELM',
    refreshInterval: 30,
    sections: {},
    gridLayout: null,
    gridColumns: 24,
    links: {},
    ...overrides,
  };
}

const node = (name) => ({ display_name: name, services: [], metrics: {} });

// No UPS: Prometheus answered and has no NUT series.
const NO_UPS = { status: null, charge: null, runtime: null, load: null, ok: true };
const UPS_ONLINE = { status: 1, charge: 100, runtime: 1800, load: 20, ok: true };

// Gitea unreachable: /api/gitea/activity fails, so commits stay at their [] seed.
const GITEA_DOWN = (sources) => ({
  ...sources,
  commits: source({ error: 'HTTP 502' }),
});

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

  it('hides the UPS and Pipeline panels when neither source is configured', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        ups: NO_UPS,
        sources: GITEA_DOWN(boardData().sources),
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
  });

  it('shows the UPS panel once the UPS reports, and keeps it with its down state after', () => {
    const data = boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, ups: UPS_ONLINE });
    const { rerenderWith } = renderBoard(freshConfig(), data);

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();

    // The NUT exporter goes away: Prometheus has no UPS series any more.
    rerenderWith({ ...data, ups: NO_UPS });

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
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
        sources: { ...boardData().sources, commits: source({ lastSuccessMs: Date.now() }) },
      })
    );

    expect(screen.getByText('Pipeline Activity')).toBeInTheDocument();
    expect(screen.getByText('No recent commits')).toBeInTheDocument();
  });

  it('does not take a demo-style {} answer for a UPS or a Gitea', () => {
    renderBoard(
      freshConfig(),
      boardData({
        serviceData: { nodes: { pve1: node('Proxmox') } },
        ups: {},
        commits: {},
        sources: { ...boardData().sources, commits: source({ lastSuccessMs: Date.now() }) },
      })
    );

    expect(screen.queryByText('UPS Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline Activity')).not.toBeInTheDocument();
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

  it('keeps the UPS and Pipeline panels a saved layout names, showing their down state', () => {
    renderBoard(
      freshConfig({ gridLayout: SAVED }),
      boardData({
        serviceData: { nodes: NODES },
        ups: NO_UPS,
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

  it('leaves a saved layout untouched when it names no UPS or Pipeline panel and neither is configured', () => {
    const saved = {
      lg: SAVED.lg.filter((it) => it.i !== 'ups' && it.i !== 'pipeline'),
    };
    renderBoard(
      freshConfig({ gridLayout: saved }),
      boardData({
        serviceData: { nodes: NODES },
        ups: NO_UPS,
        sources: GITEA_DOWN(boardData().sources),
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

  it('shows a panel switched on in Settings even before its source reports', () => {
    renderBoard(
      freshConfig({ sections: { ups: { visible: true } } }),
      boardData({ serviceData: { nodes: { pve1: node('Proxmox') } }, ups: NO_UPS })
    );

    expect(screen.getByText('UPS Power')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });
});
