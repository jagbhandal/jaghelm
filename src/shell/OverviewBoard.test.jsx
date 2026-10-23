import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { defaultConfig } from '../defaultConfig.js';
import { FIRST_RUN, HEALTHY } from '../testing/statusFixtures.js';
import OverviewBoard from './OverviewBoard.jsx';
import { useDashboardData } from './useDashboardData.js';

// The Overview's sections under its status (#306): the old grid board's
// replacement. The data hook is mocked so each test sets what the endpoints
// said; the sections are the real ones, their renders counted.

vi.mock('./useDashboardData.js', () => ({ useDashboardData: vi.fn() }));

const { renders, counted } = vi.hoisted(() => {
  const renders = { infrastructure: 0, power: 0, services: 0 };
  // A section as it is, inside a memo of its own that counts its renders.
  const counted = (key, name) => async (importOriginal) => {
    const { createElement, memo } = await import('react');
    const real = await importOriginal();
    const Inner = real[name];
    return {
      ...real,
      [name]: memo((props) => {
        renders[key] += 1;
        return createElement(Inner, props);
      }),
    };
  };
  return { renders, counted };
});
vi.mock('./OverviewInfrastructure.jsx', counted('infrastructure', 'OverviewInfrastructure'));
vi.mock('./OverviewPower.jsx', counted('power', 'OverviewPower'));
vi.mock('./OverviewServices.jsx', counted('services', 'OverviewServices'));

const source = (overrides = {}) => ({
  error: null,
  lastSuccessMs: null,
  watchedSinceMs: null,
  ...overrides,
});

const NODES = {
  pve: { display_name: 'PVE', services: [], metrics: {} },
  vm103: { display_name: 'vm103', services: [], metrics: {} },
};

function boardData(overrides = {}) {
  return {
    serviceData: { nodes: NODES },
    integrationData: {},
    history: {},
    servicesLoaded: true,
    sources: { services: source(), integrations: source() },
    healthNow: Date.now(),
    retry: vi.fn(),
    ...overrides,
  };
}

/** The poll's `updated` store, answered now. */
const UPDATED = { get: () => Date.now(), subscribe: () => () => {}, staleAfter: 72_000 };

function renderBoard({ config = defaultConfig(), data = boardData(), ...props } = {}) {
  useDashboardData.mockReturnValue(data);
  const ui = (p) => (
    <ConfigProvider config={config} setConfig={vi.fn()}>
      <OverviewBoard tick={0} active status={HEALTHY} reach="ok" updated={UPDATED} {...p} />
    </ConfigProvider>
  );
  const utils = render(ui(props));
  return {
    ...utils,
    rerenderWith: (nextData, nextProps = props) => {
      useDashboardData.mockReturnValue(nextData);
      utils.rerender(ui(nextProps));
    },
  };
}

beforeEach(() => {
  useDashboardData.mockReset();
  for (const key of Object.keys(renders)) renders[key] = 0;
});
afterEach(() => vi.restoreAllMocks());

describe('the Overview on a first boot (#566, #571)', () => {
  const firstBoot = (overrides) => boardData({ serviceData: { nodes: {}, ...overrides } });

  it('while the server waits for nodes, says they appear on their own, with no way to Settings', () => {
    const onOpenSettings = vi.fn();
    renderBoard({ status: FIRST_RUN, data: firstBoot({ discovery: 'waiting' }), onOpenSettings });
    const panel = document.querySelector('[data-slot="first-node"]');
    expect(within(panel).getByText('Waiting for your first node')).toBeInTheDocument();
    expect(panel).toHaveTextContent(
      /appear here on their own as soon as Prometheus scrapes a host/
    );
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(screen.queryByText(/in Settings/)).toBeNull();
  });

  it('with nothing discovering, says how to add one, and offers Settings', () => {
    const onOpenSettings = vi.fn();
    renderBoard({ status: FIRST_RUN, data: firstBoot(), onOpenSettings });
    expect(screen.getByText('Connect your first node')).toBeInTheDocument();
    expect(screen.getByText(/list its node in services\.yaml/)).toBeInTheDocument();
    expect(screen.queryByText(/node in Settings/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('is not drawn while /api/services is on its way, nor with a node read or modelled, nor under a filter', () => {
    const { rerenderWith } = renderBoard({
      status: FIRST_RUN,
      data: firstBoot({ discovery: 'waiting' }),
    });
    const shown = () => document.querySelector('[data-slot="first-node"]') !== null;
    expect(shown()).toBe(true);
    rerenderWith({ ...firstBoot(), servicesLoaded: false }, { status: FIRST_RUN });
    expect(shown()).toBe(false);
    rerenderWith(boardData(), { status: FIRST_RUN });
    expect(shown()).toBe(false);
    // The model has nodes /api/services hasn't read yet: theirs is the section.
    rerenderWith(firstBoot(), { status: HEALTHY });
    expect(shown()).toBe(false);
    rerenderWith(firstBoot(), {
      status: FIRST_RUN,
      filter: { id: 'services', name: 'Services', detail: '' },
    });
    expect(shown()).toBe(false);
  });
});

describe('the Overview before the first status (#243)', () => {
  it('draws nothing under the status until the poll has its first answer, and reads meanwhile', () => {
    renderBoard({ status: null, reach: 'loading' });
    expect(screen.queryByRole('region')).toBeNull();
    expect(useDashboardData).toHaveBeenCalledWith(0, expect.objectContaining({ active: true }));
  });
});

describe('the sections, in order', () => {
  it('Infrastructure, Power and Services (no job in the model), each once', () => {
    renderBoard();
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'));
    expect(regions.length).toBeGreaterThan(0);
    const names = ['Infrastructure', 'Power', 'Services'].map((name) =>
      screen.getByRole('region', { name })
    );
    expect(
      names[0].compareDocumentPosition(names[1]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      names[1].compareDocumentPosition(names[2]) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The UPS on mains, its row opening its detail (#306).
    const ups = within(screen.getByRole('region', { name: 'Power' })).getByRole('link', {
      name: /, On mains$/,
    });
    expect(ups).toHaveAttribute('href', '/?entity=power/ups');
  });

  it('a section switched off is not drawn', () => {
    renderBoard({ config: { ...defaultConfig(), overviewSections: { power: false } } });
    expect(screen.queryByRole('region', { name: 'Power' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Infrastructure' })).toBeInTheDocument();
  });
});

describe('a filter with no section of its own', () => {
  it('Integrations: a note saying where its numbers are, and Show everything', () => {
    const onClearFilter = vi.fn();
    renderBoard({
      filter: { id: 'integrations', name: 'Integrations', detail: '2 connected' },
      onClearFilter,
    });
    expect(screen.queryByRole('region', { name: 'Infrastructure' })).toBeNull();
    const note = document.querySelector('[data-slot="filter-empty"]');
    expect(note).toHaveTextContent(
      "No section of its own for IntegrationsAn integration's numbers show on its service's row, in the Services section."
    );
    fireEvent.click(within(note).getByRole('button', { name: 'Show everything' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
  });

  it('Power, its section switched off: says so, and where to switch it on', () => {
    renderBoard({
      config: { ...defaultConfig(), overviewSections: { power: false } },
      filter: { id: 'power', name: 'Power', detail: 'On mains' },
    });
    expect(document.querySelector('[data-slot="filter-empty"]')).toHaveTextContent(
      'The Power section is switched offSwitch it on in Settings → Appearance → Overview sections to see Power here.'
    );
  });

  it('Power, its section on: the section, no note', () => {
    renderBoard({ filter: { id: 'power', name: 'Power', detail: 'On mains' } });
    expect(screen.getByRole('region', { name: 'Power' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Services' })).toBeNull();
    expect(document.querySelector('[data-slot="filter-empty"]')).toBeNull();
  });
});

describe('failures, announced once', () => {
  const live = () =>
    screen.getAllByRole('status').find((el) => el.getAttribute('aria-live') === 'polite');

  it('a source that fails is announced once, from one live region, by its cause', () => {
    renderBoard({
      data: boardData({
        sources: {
          services: source({ error: 'HTTP 502', lastSuccessMs: Date.now() }),
          integrations: source({ error: 'HTTP 502', lastSuccessMs: Date.now() }),
        },
      }),
    });
    expect(live()).toHaveTextContent(
      'Live metrics unavailable — Prometheus unreachable. App metrics unavailable — integrations endpoint unreachable'
    );
  });

  it('a source no drawn section shows is not announced', () => {
    renderBoard({
      config: { ...defaultConfig(), overviewSections: { services: false } },
      data: boardData({
        sources: {
          services: source(),
          integrations: source({ error: 'HTTP 502', lastSuccessMs: Date.now() }),
        },
      }),
    });
    expect(live()).toHaveTextContent(/^$/);
  });
});

// #252: all 61 service cards re-rendered on every refresh. A tick whose
// answers are all 304s hands the board the same data (useData.js's
// stable-identity contract), and the clock a step on: no section renders
// again.
describe('a healthy tick that changes nothing (#252)', () => {
  it('renders no section again', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const data = boardData({ healthNow: 1_000_000_000_000 });
      const { rerenderWith } = renderBoard({ data });
      const first = { ...renders };
      expect(first.infrastructure).toBeGreaterThan(0);
      expect(first.power).toBeGreaterThan(0);
      expect(first.services).toBeGreaterThan(0);
      for (let tick = 1; tick <= 3; tick++) {
        act(() => vi.setSystemTime(1_000_000_000_000 + tick * 15_000));
        rerenderWith({ ...data, healthNow: 1_000_000_000_000 + tick * 15_000 }, { tick });
      }
      expect(renders).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
