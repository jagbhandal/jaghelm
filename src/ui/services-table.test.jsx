import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ServicesTable } from '@ui/services-table';

// ServicesTable (#313): the Services page's table, from the section's groups.

const row = (node, name, state, extra = {}) => ({
  id: `services/${node}:${name.toLowerCase()}`,
  anchor: `entity-services/${node}:${name.toLowerCase()}`,
  name,
  nodeName: node === 'apps' ? 'App Server' : 'Network Edge',
  containerName: name.toLowerCase(),
  state,
  word: { ok: 'Up', crit: 'Down' }[state],
  detail: state === 'ok' ? '6 users' : 'Kuma: down',
  meta: state === 'ok' ? '142 ms' : '—',
  href: `/services?entity=services/${node}:${name.toLowerCase()}`,
  onOpen: vi.fn(),
  ...extra,
});
const GROUPS = [
  {
    key: 'node:apps',
    title: 'App Server',
    rows: [row('apps', 'Jellyfin', 'crit'), row('apps', 'Nextcloud', 'ok')],
  },
  { key: 'node:edge', title: 'Network Edge', rows: [row('edge', 'AdGuard', 'ok')] },
];

describe('ServicesTable', () => {
  it("a row per service in the groups' order, each opening it, its state the model's", async () => {
    render(<ServicesTable groups={GROUPS} grouping="node" />);
    const table = screen.getByRole('table', { name: 'Services' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Service', 'Node', 'Container', 'Detail', 'Latency', 'Heartbeats', 'State']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent)
    ).toEqual(['Jellyfin', 'Nextcloud', 'AdGuard']);
    const jellyfin = within(table).getByRole('link', { name: 'Jellyfin' });
    expect(jellyfin).toHaveAttribute('href', '/services?entity=services/apps:jellyfin');
    expect(jellyfin).toHaveAttribute('id', 'entity-services/apps:jellyfin');
    await userEvent.setup().click(jellyfin);
    expect(GROUPS[0].rows[0].onOpen).toHaveBeenCalled();
    const first = within(table).getAllByRole('row')[1];
    expect(within(first).getByText('Kuma: down')).toHaveClass('text-crit-fg');
    expect(within(first).getByText('Down')).toBeInTheDocument();
    expect(within(first).getByText('jellyfin')).toHaveClass('font-mono');
    // A healthy row's detail is quiet.
    expect(within(table).getAllByText('6 users')[0]).toHaveClass('text-text-2');
  });

  it('#671: a since-restart strip has its note and unrecorded slots; a Kuma one has neither', () => {
    const checks = [{ state: 'ok', word: 'Up', time: 1, ping: 12 }];
    const groups = [
      {
        key: 'node:apps',
        title: 'App Server',
        rows: [
          row('apps', 'Jellyfin', 'ok', { beats: checks, beatsHistory: 'since-restart' }),
          row('apps', 'Postgres', 'ok', { beats: checks, beatsHistory: 'kuma' }),
        ],
      },
    ];
    render(<ServicesTable groups={groups} grouping="node" />);
    const [, jellyfin, postgres] = within(screen.getByRole('table', { name: 'Services' })).getAllByRole('row');
    expect(within(jellyfin).getByText('history since restart')).toBeInTheDocument();
    expect(jellyfin.querySelector('[data-beat="unrecorded"]')).toBeTruthy();
    expect(within(postgres).queryByText('history since restart')).toBeNull();
    expect(postgres.querySelector('[data-beat="unrecorded"]')).toBeNull();
  });

  it("a monitored service's heartbeat strip (#312); a dash for one with no monitor; no level colour while stale", () => {
    const checks = [
      { state: 'ok', word: 'Up', time: 1, ping: 12 },
      { state: 'crit', word: 'Down', time: 2, ping: null },
    ];
    const groups = [
      {
        key: 'node:apps',
        title: 'App Server',
        rows: [
          row('apps', 'Jellyfin', 'crit', { beats: checks }),
          row('apps', 'Postgres', 'ok', { beats: null }),
        ],
      },
    ];
    const { rerender } = render(<ServicesTable groups={groups} grouping="node" />);
    const table = screen.getByRole('table', { name: 'Services' });
    const [, jellyfin, postgres] = within(table).getAllByRole('row');
    const strip = within(jellyfin).getByRole('img', {
      name: 'Heartbeats: 1 failure in the last 2 checks, including the latest',
    });
    expect(strip.querySelectorAll('[data-slot="beat"]')).toHaveLength(30);
    expect(strip.querySelector('[data-beat="crit"]')).toHaveClass('bg-crit-solid');
    expect(within(postgres).queryByRole('img')).toBeNull();

    const stale = groups.map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, stale: true })) }));
    rerender(<ServicesTable groups={stale} grouping="node" />);
    expect(table.querySelector('[data-beat="crit"]')).toHaveClass('bg-unknown-solid');
    expect(table.querySelector('[data-beat="crit"]')).not.toHaveClass('bg-crit-solid');
  });

  it('grouped by custom group, it names each row its group', () => {
    render(
      <ServicesTable
        groups={[{ ...GROUPS[0], key: 'group:media', title: 'Media' }]}
        grouping="group"
      />
    );
    const table = screen.getByRole('table', { name: 'Services' });
    expect(within(table).getByRole('columnheader', { name: 'Group' })).toBeInTheDocument();
    expect(within(table).getAllByText('Media')).toHaveLength(2);
  });
});
