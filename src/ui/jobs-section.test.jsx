import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { JobsList, JobsSection } from '@ui/jobs-section';

const row = (id, name, state, word, extra = {}) => ({
  id,
  name,
  where: id.split('/')[1].split(':')[0],
  state,
  word,
  detail: state === 'ok' ? 'daily at 03:00' : `Last run ${word.toLowerCase()}`,
  meta: '3 h ago',
  muted: true,
  ...extra,
});

const GROUPS = [
  {
    key: 'jobs',
    title: 'Jobs',
    count: '1 / 2 OK',
    rows: [
      row('jobs/pi-2:npm-sync', 'npm-sync', 'warn', 'Overdue', {
        detail: 'Overdue: no report on schedule (expected every 15 min)',
      }),
      row('jobs/wiki:docs-health', 'docs-health', 'ok', 'OK'),
    ],
  },
  {
    key: 'backups',
    title: 'Backups',
    count: '0 / 1 OK',
    rows: [
      row('backups/nas:nas-b2-backup', 'nas-b2-backup', 'crit', 'Failed', {
        detail: 'Last backup failed: repository is locked',
      }),
    ],
  },
];

const rowOf = (name) => screen.getByText(name).closest('[data-slot="entity-row"]');

describe('JobsSection (#578)', () => {
  it('is a region named Jobs: its count, a list per group under its heading, a row per job', () => {
    render(<JobsSection groups={GROUPS} count="3 scheduled · 1 failed · 1 overdue" />);
    const section = screen.getByRole('region', { name: 'Jobs' });
    expect(within(section).getByText('3 scheduled · 1 failed · 1 overdue')).toBeInTheDocument();
    const jobs = within(section).getByRole('list', { name: 'Jobs' });
    const backups = within(section).getByRole('list', { name: 'Backups' });
    expect(within(jobs).getAllByRole('listitem')).toHaveLength(2);
    expect(within(backups).getAllByRole('listitem')).toHaveLength(1);
    expect(within(section).getByText('1 / 2 OK')).toBeInTheDocument();
    // Each row: its node beside its name, the detail, the age.
    const sync = rowOf('npm-sync');
    expect(sync).toHaveTextContent('pi-2');
    expect(sync).toHaveTextContent('3 h ago');
  });

  it('draws overdue and failed rows in the status roles: a failed backup critical, an overdue job a warning', () => {
    render(<JobsSection groups={GROUPS} count="3 scheduled" />);
    const backup = rowOf('nas-b2-backup');
    expect(backup).toHaveAttribute('data-state', 'crit');
    expect(backup.querySelector('[data-slot="entity-grid"]')).toHaveClass('@2xl:bg-crit-tint');
    expect(backup.querySelector('[data-slot="entity-detail"]')).toHaveClass('text-crit-fg');
    expect(backup.querySelector('[data-slot="status-lamp"]')).toHaveAttribute('data-shape', 'bar');
    const sync = rowOf('npm-sync');
    expect(sync).toHaveAttribute('data-state', 'warn');
    expect(sync.querySelector('[data-slot="entity-detail"]')).toHaveClass('text-warn-fg');
    expect(sync.querySelector('[data-slot="status-lamp"]')).toHaveAttribute('data-shape', 'slash');
    // A healthy row is muted, never green text.
    const docs = rowOf('docs-health');
    expect(docs).toHaveAttribute('data-muted');
    expect(docs.querySelector('[data-slot="entity-detail"]')).toHaveClass('text-text-2');
  });

  it('a row with a link opens its job, and carries its entity id', async () => {
    const onOpen = vi.fn();
    const groups = [
      {
        ...GROUPS[0],
        rows: GROUPS[0].rows.map((r) => ({ ...r, href: `/?entity=${r.id}`, onOpen })),
      },
    ];
    render(<JobsSection groups={groups} count="2 scheduled" />);
    const link = screen.getByRole('link', { name: 'npm-sync, Overdue' });
    expect(link).toHaveAttribute('href', '/?entity=jobs/pi-2:npm-sync');
    expect(link).toHaveAttribute('data-entity', 'jobs/pi-2:npm-sync');
    await userEvent.setup().click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('with no group left, a quiet line under a heading that takes focus from a script (#578)', () => {
    render(<JobsSection groups={[]} count="0 scheduled" />);
    const section = screen.getByRole('region', { name: 'Jobs' });
    expect(within(section).queryByRole('list')).toBeNull();
    expect(section.querySelector('[data-slot="jobs-empty"]')).toHaveTextContent(
      'None left to list: a removed job comes back when it reports again.'
    );
    const heading = within(section).getByRole('heading', { name: 'Jobs', level: 2 });
    expect(heading).toHaveAttribute('tabindex', '-1');
    heading.focus();
    expect(heading).toHaveFocus();
  });

  it('while loading, placeholder rows and no count', () => {
    render(<JobsSection loading count="3 scheduled" />);
    const section = screen.getByRole('region', { name: 'Jobs' });
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(within(section).getByText('The jobs are loading')).toBeInTheDocument();
    expect(within(section).queryByText('3 scheduled')).toBeNull();
  });

  it('JobsList: the same panel under a phone screen’s overline heading, no icon', () => {
    const { container } = render(<JobsList groups={GROUPS} count="3 scheduled" />);
    const section = screen.getByRole('region', { name: 'Jobs' });
    expect(within(section).getByRole('heading', { name: 'Jobs', level: 2 })).toHaveClass(
      'text-overline'
    );
    expect(within(section).getByText('3 scheduled')).toBeInTheDocument();
    expect(section.querySelector('[data-slot="jobs-list"]')).not.toBeNull();
    expect(container.querySelector('svg.lucide')).toBeNull();
    expect(within(section).getAllByRole('list')).toHaveLength(2);
  });
});
