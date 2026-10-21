import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AttentionPanel } from '@ui/attention-panel';

// The mock's incident.
const ISSUES = [
  {
    id: 'immich',
    state: 'crit',
    word: 'Down',
    title: 'Immich',
    where: 'Service · Production (vm-103)',
    reason: 'Kuma: HTTP 502 for 4 min',
    age: '4 m',
  },
  {
    id: 'ups',
    state: 'crit',
    word: 'On battery',
    title: 'UPS',
    where: 'Power',
    reason: '82 % charge · about 31 min runtime left',
    age: '2 m',
  },
  {
    id: 'wiki',
    state: 'unknown',
    word: 'No signal',
    title: 'Wiki.js',
    where: 'Service · Production (vm-103)',
    reason: 'No heartbeat yet',
    age: '2 m',
  },
];

const incident = {
  state: 'crit',
  counts: '2 critical, 2 warnings, 1 no signal',
  subline: 'Immich is down and the UPS is on battery.',
};

describe('AttentionPanel', () => {
  it('names the overall state as the page heading, in its colour, with the counts after it', () => {
    render(<AttentionPanel {...incident} issues={ISSUES} />);
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(panel).toHaveClass('rounded-xl', 'border', 'bg-surface-1');
    const heading = within(panel).getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Critical · 2 critical, 2 warnings, 1 no signal');
    expect(heading).toHaveClass('text-headline');
    expect(within(heading).getByText('Critical')).toHaveClass('font-bold', 'text-crit-fg');
    expect(within(heading).getByText(/2 critical/)).toHaveClass('text-text-2', 'font-semibold');
    // The 14px lamp adds the shape; the word beside it names the state.
    const lamp = panel.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('width', '14');
    expect(lamp).toHaveAttribute('data-shape', 'bar');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(panel).getByText('Immich is down and the UPS is on battery.')).toHaveClass(
      'text-text-2'
    );
  });

  it('lists the issues as rows that open what they name', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <AttentionPanel
        {...incident}
        issues={[{ ...ISSUES[0], onOpen }, { ...ISSUES[1], href: '/power' }, ISSUES[2]]}
      />
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    await user.click(
      screen.getByRole('button', { name: 'Immich, Down, Service · Production (vm-103)' })
    );
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'UPS, On battery, Power' })).toHaveAttribute(
      'href',
      '/power'
    );
    // A row with nothing to open is content, not a control.
    expect(within(items[2]).queryByRole('button')).toBeNull();
    expect(screen.getByRole('list')).toHaveClass('divide-y', 'border-t');
  });

  it('shows the action, and the filter with Clear', async () => {
    const user = userEvent.setup();
    const onClearFilter = vi.fn();
    render(
      <AttentionPanel
        {...incident}
        issues={ISSUES.slice(0, 1)}
        action={<a href="#alerts">All alerts →</a>}
        filter="Services"
        onClearFilter={onClearFilter}
      />
    );
    expect(screen.getByRole('link', { name: 'All alerts →' })).toBeInTheDocument();
    expect(screen.getByText('Showing Services only')).toBeInTheDocument();
    expect(screen.queryByText(/needs attention$/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
  });

  it('says so, quietly, when the subsystem it is filtered to has nothing to show', () => {
    render(<AttentionPanel {...incident} issues={[]} filter="Jobs" onClearFilter={() => {}} />);
    const panel = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(panel).getByText('Showing Jobs only')).toBeInTheDocument();
    expect(within(panel).getByText('Nothing in Jobs needs attention')).toHaveClass(
      'text-body-sm',
      'text-text-3'
    );
    expect(within(panel).queryByRole('list')).toBeNull();
  });

  it('is the quiet line when all is well: no green word, no list', () => {
    render(
      <AttentionPanel
        state="ok"
        counts="32 services up · 6 nodes healthy · backups on time"
        meta="Last incident 2 d ago"
      />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    const heading = within(line).getByRole('heading', { level: 1, name: 'All systems normal' });
    expect(heading).toHaveClass('text-title-xs');
    expect(line.querySelector('.text-ok-fg')).toBeNull();
    // The heading says the state once; the lamp beside it is its shape only.
    const lamp = line.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'disc');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(line).queryByRole('img')).toBeNull();
    expect(within(line).getAllByText('All systems normal')).toHaveLength(1);
    expect(within(line).getByText('Last incident 2 d ago')).toHaveClass('ml-auto', 'text-caption');
    expect(screen.queryByRole('list')).toBeNull();
  });

  // #298: a filter from the subsystem strip on a quiet board still says so,
  // with its Clear, at the end of the line.
  it('says the filter on the quiet line too, with Clear', async () => {
    const user = userEvent.setup();
    const onClearFilter = vi.fn();
    render(
      <AttentionPanel
        state="ok"
        counts="All 12 services up · 3 nodes healthy"
        filter="Nodes"
        onClearFilter={onClearFilter}
      />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    expect(within(line).getByRole('heading', { name: 'All systems normal' })).toBeInTheDocument();
    const note = within(line).getByText('Showing Nodes only');
    expect(note.parentElement).toHaveClass('ml-auto', 'text-body-sm', 'text-text-2');
    expect(screen.queryByText(/needs attention/)).toBeNull();
    await user.click(within(line).getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
  });

  // Spec §6.1: maintenance doesn't break the quiet line; the subsystem detail
  // under it ("1 in maintenance") says what is in maintenance.
  it('stays quiet for maintenance, which is never an issue, and not for a warning', () => {
    const { rerender } = render(
      <AttentionPanel state="maintenance" counts="32 services up · 1 in maintenance" />
    );
    const line = screen.getByRole('region', { name: 'Status' });
    expect(within(line).getByRole('heading', { name: 'All systems normal' })).toBeInTheDocument();
    expect(within(line).getByText('32 services up · 1 in maintenance')).toHaveClass('text-text-2');
    expect(within(line).queryByText('Maintenance')).toBeNull();
    const lamp = line.querySelector('[data-slot="status-lamp"]');
    expect(lamp).toHaveAttribute('data-shape', 'wrench');
    expect(lamp).toHaveAttribute('aria-hidden', 'true');
    expect(within(line).queryByRole('img')).toBeNull();
    rerender(<AttentionPanel state="warn" counts="1 warning" />);
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Warning · 1 warning');
  });

  // #449: with nothing set up the model's board is empty, its own overall
  // state: no issue, nothing silent, and no health anybody checked.
  it('is the quiet line when nothing is set up (empty): no lamp, no alarm, the sentence once', () => {
    const { rerender } = render(<AttentionPanel state="empty" counts="Nothing monitored yet" />);
    const line = screen.getByRole('region', { name: 'Status' });
    expect(line).toHaveAttribute('data-state', 'empty');
    const heading = within(line).getByRole('heading', { level: 1, name: 'Nothing monitored yet' });
    expect(heading).toHaveClass('text-title-xs');
    expect(within(line).getAllByText('Nothing monitored yet')).toHaveLength(1);
    // No state to show, so no lamp, and none of a state's words.
    expect(line.querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(line.querySelector('[data-slot="status-word"]')).toBeNull();
    expect(within(line).queryByText('No signal')).toBeNull();
    expect(within(line).queryByText('All systems normal')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Needs attention' })).toBeNull();
    // Without the sentence it says the same; with a word, the word heads it.
    rerender(<AttentionPanel state="empty" />);
    expect(screen.getByRole('heading', { name: 'Nothing monitored yet' })).toBeInTheDocument();
    rerender(<AttentionPanel state="empty" word="Set up JagHelm" counts="Nothing monitored yet" />);
    expect(screen.getByRole('heading', { name: 'Set up JagHelm' })).toBeInTheDocument();
    expect(screen.getByText('Nothing monitored yet')).toHaveClass('text-text-2');
  });

  it('takes another heading level', () => {
    render(<AttentionPanel state="crit" titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Critical');
  });
});
