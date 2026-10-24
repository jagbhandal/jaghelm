import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ServicesSection } from '@ui/services-section';

const row = (name, state, extra = {}) => ({
  id: `services/apps:${name.toLowerCase()}`,
  anchor: `entity-services/apps:${name.toLowerCase()}`,
  name,
  where: null,
  state,
  word: { ok: 'Up', crit: 'Down', warn: 'Pending', unknown: 'No signal' }[state],
  detail: state === 'ok' ? '6 users' : 'Kuma: down',
  meta: state === 'ok' ? '142 ms' : '—',
  muted: state === 'ok',
  ...extra,
});

const GROUPS = [
  {
    key: 'node:apps',
    title: 'App Server',
    host: 'apps',
    count: '1 / 2 up',
    rows: [row('Jellyfin', 'crit'), row('Nextcloud', 'ok')],
  },
  {
    key: 'node:edge',
    title: 'Network Edge',
    host: 'edge',
    count: '1 / 1 up',
    rows: [
      row('AdGuard Home', 'ok', {
        id: 'services/edge:adguard',
        anchor: 'entity-services/edge:adguard',
      }),
    ],
  },
];
const GROUPINGS = [
  { value: 'node', label: 'Node' },
  { value: 'group', label: 'Group' },
];

// The classes that paint a level: a word colour, a tint, a solid.
const LEVEL = /(^|:)(text|bg|border|fill|stroke)-(ok|warn|crit)(-|$)/;
const levelClasses = (root) =>
  [...root.querySelectorAll('*')]
    .filter((el) => !el.closest('[data-slot="status-lamp"]'))
    .flatMap((el) => [...el.classList].filter((c) => LEVEL.test(c)));

describe('ServicesSection', () => {
  it('is a region named Services: its count, a list per group under its heading, a row per service', () => {
    render(<ServicesSection groups={GROUPS} count="3 monitored · 1 down" />);
    const section = screen.getByRole('region', { name: 'Services' });
    expect(within(section).getByText('3 monitored · 1 down')).toBeInTheDocument();
    const lists = within(section).getAllByRole('list');
    expect(lists.map((l) => l.getAttribute('aria-labelledby'))).toHaveLength(2);
    const apps = within(section).getByRole('list', { name: 'App Server' });
    expect(
      within(apps)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual([expect.stringContaining('Jellyfin'), expect.stringContaining('Nextcloud')]);
    expect(within(section).getByRole('heading', { level: 3, name: 'App Server' })).toHaveClass(
      'text-overline',
      'uppercase',
      'text-text-2'
    );
    // The node's key beside its name, and the group's count.
    expect(within(section).getByText('apps')).toHaveClass('font-mono', 'text-text-3');
    expect(within(section).getByText('1 / 2 up')).toBeInTheDocument();
  });

  it('each row carries its anchor and names its lamp by the word', () => {
    const { container } = render(<ServicesSection groups={GROUPS} count="3 monitored" />);
    const jellyfin = container.querySelector('[id="entity-services/apps:jellyfin"]');
    expect(jellyfin).toHaveAttribute('data-slot', 'entity-row');
    expect(within(jellyfin).getByRole('img', { name: 'Down' })).toBeInTheDocument();
    expect(within(jellyfin).getByText('Kuma: down')).toBeInTheDocument();
  });

  it('healthy rows are muted; a failing row is not, its detail in its colour, critical tinted', () => {
    const { container } = render(<ServicesSection groups={GROUPS} count="3 monitored" />);
    const at = (id) => container.querySelector(`[data-entity="${id}"]`);
    for (const id of ['services/apps:nextcloud', 'services/edge:adguard']) {
      expect(at(id), id).toHaveAttribute('data-muted', '');
      expect(at(id).querySelector('[data-slot="entity-detail"]')).toHaveClass('text-text-2');
    }
    const down = at('services/apps:jellyfin');
    expect(down).not.toHaveAttribute('data-muted');
    expect(down.querySelector('[data-slot="entity-detail"]')).toHaveClass('text-crit-fg');
    expect(down.querySelector('[data-slot="entity-grid"]')).toHaveClass('@2xl:bg-crit-tint');
  });

  // #480, #495: what the shell gives a stale status's rows.
  it('no signal: every lamp the steel ring named "No signal", no level colour anywhere, the words kept', () => {
    const stale = GROUPS.map((g) => ({
      ...g,
      rows: g.rows.map((r) => ({ ...r, state: 'unknown' })),
    }));
    const { container } = render(
      <ServicesSection groups={stale} count="3 monitored · No signal · last known 3 min ago" />
    );
    const lamps = container.querySelectorAll('[data-slot="status-lamp"]');
    expect(lamps).toHaveLength(3);
    for (const lamp of lamps) {
      expect(lamp).toHaveAttribute('data-state', 'unknown');
      expect(lamp).toHaveAccessibleName('No signal');
    }
    expect(levelClasses(container)).toEqual([]);
    // What was last known stays, as words.
    expect(screen.getByText('Kuma: down').closest('[data-slot="entity-detail"]')).toHaveClass(
      'text-unknown-fg'
    );
    expect(screen.getByText('3 monitored · No signal · last known 3 min ago')).toBeInTheDocument();
  });

  it('#671: a since-restart row says so once to a screen reader, and beside its strip from 672px', () => {
    const checks = [{ state: 'ok', word: 'Up', time: 1, ping: 9 }];
    const groups = [
      {
        ...GROUPS[0],
        rows: [
          row('Jellyfin', 'ok', { beats: checks, beatsHistory: 'since-restart', onOpen: vi.fn() }),
          row('Postgres', 'ok', { beats: checks, onOpen: vi.fn() }),
        ],
      },
    ];
    const { container } = render(<ServicesSection groups={groups} count="2" />);
    const [jellyfin, postgres] = container.querySelectorAll('[data-slot="entity-row"]');
    expect(within(jellyfin).getByText('history since restart')).toBeInTheDocument();
    expect(within(postgres).queryByText('history since restart')).toBeNull();
    // Exactly one "since restart" in the description: the strip's name, not the note too.
    expect(jellyfin).toHaveAccessibleDescription(
      /^(?:(?!since restart).)*since restart(?:(?!since restart).)*$/is
    );
    expect(jellyfin.querySelector('[data-slot="strip-with-note"]')).toHaveClass('@2xl:flex-row-reverse');
  });

  it("a monitored row carries its strip of 30; a row with no monitor keeps the room, empty (#312)", () => {
    const checks = [
      { state: 'ok', word: 'Up', time: 1, ping: 9 },
      { state: 'crit', word: 'Down', time: 2, ping: null },
    ];
    const groups = [
      {
        ...GROUPS[0],
        rows: [
          row('Jellyfin', 'crit', { beats: checks, onOpen: vi.fn() }),
          row('Postgres', 'ok', { onOpen: vi.fn() }),
        ],
      },
    ];
    const { container, rerender } = render(<ServicesSection groups={groups} count="2" />);
    const [jellyfin, postgres] = container.querySelectorAll('[data-slot="entity-row"]');
    const strip = within(jellyfin).getByRole('img', {
      name: 'Heartbeats: 1 failure in the last 2 checks, including the latest',
    });
    expect(strip.querySelectorAll('[data-slot="beat"]')).toHaveLength(30);
    expect(jellyfin).toHaveAccessibleDescription(
      expect.stringContaining('Heartbeats: 1 failure in the last 2 checks')
    );
    expect(postgres.querySelector('[data-slot="uptime-bar"]')).toBeNull();
    const space = postgres.querySelector('[data-slot="beat-space"]');
    expect(space).toHaveClass('invisible');
    expect(space.querySelectorAll('[data-slot="beat"]')).toHaveLength(30);
    expect(postgres).not.toHaveAccessibleDescription(expect.stringContaining('Heartbeats'));

    // No row with a strip (no Kuma): no strip and no room anywhere.
    rerender(<ServicesSection groups={GROUPS} count="3" />);
    expect(container.querySelector('[data-slot="uptime-bar"], [data-slot="beat-space"]')).toBeNull();

    // A stale status: the strip keeps its shape, in no level colour.
    const stale = [{ ...groups[0], rows: groups[0].rows.map((r) => ({ ...r, state: 'unknown', stale: true })) }];
    rerender(<ServicesSection groups={stale} count="2" />);
    expect(levelClasses(container)).toEqual([]);
    expect(container.querySelector('[data-beat="crit"]')).toHaveClass('bg-unknown-solid');
  });

  it('grouped by anything but node: the node beside each name', () => {
    const groups = [
      {
        key: 'group:media',
        title: 'Media',
        host: null,
        count: '0 / 1 up',
        rows: [row('Jellyfin', 'crit', { where: 'App Server' })],
      },
    ];
    const { container } = render(
      <ServicesSection groups={groups} count="1 monitored" grouping="group" />
    );
    expect(container.querySelector('[data-slot="entity-where"]')).toHaveTextContent('App Server');
    expect(screen.getByRole('region', { name: 'Services' })).toHaveAttribute(
      'data-grouping',
      'group'
    );
  });

  it('the grouping is a radio group, "Group services by", that asks for the other one', async () => {
    const user = userEvent.setup();
    const onGroupingChange = vi.fn();
    render(
      <ServicesSection
        groups={GROUPS}
        count="3 monitored"
        grouping="node"
        groupings={GROUPINGS}
        onGroupingChange={onGroupingChange}
      />
    );
    const control = screen.getByRole('radiogroup', { name: 'Group services by' });
    expect(within(control).getByRole('radio', { name: 'Node' })).toBeChecked();
    await user.click(within(control).getByRole('radio', { name: 'Group' }));
    expect(onGroupingChange).toHaveBeenCalledWith('group');
  });

  it('a way to group that has nothing yet is disabled, and the hint says where to set it up', () => {
    render(
      <ServicesSection
        groups={GROUPS}
        grouping="node"
        groupings={[GROUPINGS[0], { ...GROUPINGS[1], disabled: true }]}
        onGroupingChange={vi.fn()}
        groupingHint={
          <>
            No groups yet: <a href="/settings/sections">add one in Settings → Sections</a>
          </>
        }
      />
    );
    const control = screen.getByRole('radiogroup', { name: 'Group services by' });
    expect(within(control).getByRole('radio', { name: 'Group' })).toBeDisabled();
    expect(within(control).getByRole('radio', { name: 'Node' })).toBeChecked();
    expect(control).toHaveAccessibleDescription('No groups yet: add one in Settings → Sections');
    expect(screen.getByRole('link', { name: 'add one in Settings → Sections' })).toHaveAttribute(
      'href',
      '/settings/sections'
    );
  });

  it('no control with nothing to change it', () => {
    render(<ServicesSection groups={GROUPS} groupings={GROUPINGS} />);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('loading: busy, placeholder rows, no count', () => {
    render(<ServicesSection loading count="3 monitored" />);
    const section = screen.getByRole('region', { name: 'Services' });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).getByText('The services are loading')).toHaveClass('sr-only');
    expect(within(section).queryByText('3 monitored')).toBeNull();
    expect(within(section).queryByRole('list')).toBeNull();
  });
});

// The Services page's parts (#313): the list / table toggle, the table in the
// panel's place (ServicesTable, its own module), the filters' row and what
// stands in when they leave nothing; and the Overview's "Show all".
describe('ServicesSection on the Services page', () => {
  const TABLE = <table aria-label="A table" />;

  it('no toggle without a table (the Overview); with one, "Service view": List or Table', async () => {
    const { rerender } = render(
      <ServicesSection groups={GROUPS} view="list" onViewChange={vi.fn()} />
    );
    expect(screen.queryByRole('radiogroup', { name: 'Service view' })).toBeNull();
    const onViewChange = vi.fn();
    rerender(
      <ServicesSection groups={GROUPS} view="list" onViewChange={onViewChange} table={TABLE} />
    );
    const toggle = screen.getByRole('radiogroup', { name: 'Service view' });
    expect(within(toggle).getByRole('radio', { name: 'List' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await userEvent.setup().click(within(toggle).getByRole('radio', { name: 'Table' }));
    expect(onViewChange).toHaveBeenCalledWith('table');
  });

  it('the table in the panel’s place, no list beside it', () => {
    render(<ServicesSection groups={GROUPS} view="table" onViewChange={vi.fn()} table={TABLE} />);
    const section = screen.getByRole('region', { name: 'Services' });
    expect(section).toHaveAttribute('data-view', 'table');
    expect(within(section).getByRole('table', { name: 'A table' })).toBeInTheDocument();
    expect(within(section).queryAllByRole('list')).toEqual([]);
  });

  it("the filters' row under the heading, and the empty state when no group has a row", () => {
    const empty = <p>No services match these filters</p>;
    const { rerender } = render(
      <ServicesSection groups={GROUPS} toolbar={<div data-testid="filters" />} empty={empty} />
    );
    const section = screen.getByRole('region', { name: 'Services' });
    expect(within(section).getByTestId('filters')).toBeInTheDocument();
    expect(within(section).queryByText('No services match these filters')).toBeNull();
    rerender(<ServicesSection groups={[]} toolbar={<div data-testid="filters" />} empty={empty} />);
    expect(within(section).getByText('No services match these filters')).toBeInTheDocument();
    expect(section.querySelector('[data-slot="services-list"]')).toBeNull();
  });

  it('"Show all" at the panel’s foot: a link, opened in the page on a plain click', async () => {
    const onOpen = vi.fn();
    render(
      <ServicesSection
        groups={GROUPS}
        showAll={{ href: '/services', label: 'Show all 3 services', onOpen }}
      />
    );
    const link = screen.getByRole('link', { name: 'Show all 3 services' });
    expect(link).toHaveAttribute('href', '/services');
    expect(link).toHaveClass('text-accent-text', 'font-semibold');
    expect(link.closest('[data-slot="services-list"]')).not.toBeNull();
    await userEvent.setup().click(link);
    expect(onOpen).toHaveBeenCalled();
  });
});
