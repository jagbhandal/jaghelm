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
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClearFilter).toHaveBeenCalledOnce();
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
    expect(within(line).getByRole('img', { name: 'All systems normal' })).toHaveAttribute(
      'data-shape',
      'disc'
    );
    expect(within(line).getByText('Last incident 2 d ago')).toHaveClass('ml-auto', 'text-caption');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('stays quiet for maintenance, which is never an issue, and not for a warning', () => {
    const { rerender } = render(<AttentionPanel state="maintenance" />);
    expect(screen.getByRole('region', { name: 'Status' })).toHaveTextContent('Maintenance');
    expect(screen.getByRole('img', { name: 'Maintenance' })).toHaveAttribute(
      'data-shape',
      'wrench'
    );
    rerender(<AttentionPanel state="warn" counts="1 warning" />);
    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Warning · 1 warning');
  });

  it('takes another heading level', () => {
    render(<AttentionPanel state="crit" titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Critical');
  });

  it("is the Android app's SystemStatusCard in the android look", () => {
    const { container } = render(
      <AttentionPanel
        look="android"
        severity="critical"
        headline="Two services down"
        word="down"
        subline="jellyfin · vaultwarden"
        counts="14 up · 2 down · 3 nodes"
      />
    );
    expect(container.firstChild).toHaveClass('sys-status-card', 'sys-status-card--critical');
    expect(screen.getByText('System status')).toBeInTheDocument();
    expect(container.querySelector('.sys-status-card__word--critical')).toHaveTextContent('down');
  });
});
