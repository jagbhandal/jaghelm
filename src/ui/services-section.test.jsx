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
