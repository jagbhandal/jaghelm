import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { AlertHistory, EventRow } from '@ui/alert-history';

// #314: the History section and its rows, the `ui` look.

const down = {
  id: '9',
  entity: 'services/apps:jellyfin',
  state: 'crit',
  name: 'Jellyfin',
  where: 'Service · apps',
  change: 'Down',
  reason: 'Kuma: down',
  at: Date.parse('2026-10-23T11:45:00Z'),
  time: '11:45',
  delivery: 'Sent to 2 phones',
  reached: true,
  gone: false,
};
const up = {
  ...down,
  id: '10',
  state: 'ok',
  change: 'Down → Up',
  reason: 'Kuma: up',
  time: '11:51',
};

describe('EventRow', () => {
  it('is a link the page opens itself, named name, severity, change, where, time; described by why and the phones', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<EventRow event={down} href="/alerts?entity=services/apps:jellyfin" onOpen={onOpen} />);
    const row = screen.getByRole('link', {
      name: 'Jellyfin, Critical, Down, Service · apps, 11:45',
    });
    expect(row).toHaveAccessibleDescription('Kuma: down Sent to 2 phones');
    expect(row).toHaveAttribute('data-slot', 'event-row');
    expect(row).toHaveAttribute('data-state', 'crit');
    await user.click(row);
    expect(onOpen).toHaveBeenCalledOnce();
    // A modified click is the browser's: a new tab, the page left alone.
    fireEvent.click(row, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('draws the change in its state’s word colour; a recovery stays text-1 (healthy stays quiet)', () => {
    const { rerender } = render(<EventRow event={down} onOpen={() => {}} />);
    for (const el of screen.getAllByText('Down'))
      expect(el).toHaveClass('font-bold', 'text-crit-fg');
    rerender(<EventRow event={up} onOpen={() => {}} />);
    for (const el of screen.getAllByText('Down → Up')) {
      expect(el).toHaveClass('text-text-1');
      expect(el.className).not.toMatch(/text-ok-fg/);
    }
    expect(screen.getByRole('button')).toHaveAccessibleName(/^Jellyfin, Info, Down → Up/);
  });

  it('an entity the model no longer has says so under its name', () => {
    render(<EventRow event={{ ...down, gone: true }} href="/alerts?entity=x" />);
    expect(screen.getByRole('link')).toHaveAccessibleName(
      'Jellyfin, Critical, Down, Service · apps · No longer monitored, 11:45'
    );
  });

  it('with nothing to open, is plain content, no chevron, its words still shown', () => {
    const { container } = render(
      <EventRow
        event={{
          ...down,
          entity: null,
          name: 'Updates · apps',
          where: undefined,
          change: null,
          reason: '3 updated',
        }}
      />
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('svg.lucide-chevron-right')).toBeNull();
    expect(container).toHaveTextContent('Updates · apps');
    expect(container).toHaveTextContent('3 updated');
  });

  it('dates its time for machines', () => {
    const { container } = render(<EventRow event={down} />);
    for (const time of container.querySelectorAll('time')) {
      expect(time).toHaveAttribute('dateTime', '2026-10-23T11:45:00.000Z');
    }
  });
});

describe('AlertHistory', () => {
  const days = [
    { day: '2026-10-23', label: 'Today', rows: [up, down] },
    { day: '2026-10-22', label: 'Yesterday', rows: [{ ...down, id: '3', time: '08:00' }] },
  ];

  it('is the History region: its heading, then each day under its label, newest first', () => {
    render(<AlertHistory days={days} />);
    const region = screen.getByRole('region', { name: 'History' });
    expect(within(region).getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
    expect(region).toHaveTextContent('Last 30 days');
    expect(
      within(region)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent)
    ).toEqual(['Today', 'Yesterday']);
    expect(within(region).getAllByRole('listitem')).toHaveLength(3);
  });

  it('on the phone, the screens’ section label', () => {
    render(<AlertHistory heading="overline" days={days} titleAs="h2" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('History · last 30 days');
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-overline', 'uppercase');
  });

  it('loading: busy, said once, no rows and no empty line', () => {
    render(<AlertHistory state="loading" />);
    const region = screen.getByRole('region', { name: 'History' });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('Loading the history');
    expect(region).not.toHaveTextContent('No alerts');
  });

  it('nothing in 30 days: the empty line', () => {
    render(<AlertHistory days={[]} empty="No critical alerts in the last 30 days." />);
    expect(screen.getByText('No critical alerts in the last 30 days.')).toBeInTheDocument();
  });

  it('a failed read: a banner that says so, with Retry, never the empty line', async () => {
    const onRetry = vi.fn();
    render(<AlertHistory state="error" onRetry={onRetry} />);
    const region = screen.getByRole('region', { name: 'History' });
    expect(region).toHaveTextContent('History unavailable');
    expect(region).not.toHaveTextContent('No alerts');
    await userEvent.setup().click(within(region).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('a server without a history: one line, no error', () => {
    render(<AlertHistory state="old" />);
    const region = screen.getByRole('region', { name: 'History' });
    expect(region).toHaveTextContent('History needs a newer JagHelm server.');
    expect(region).not.toHaveTextContent('unavailable');
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('a refresh that failed: the rows it last had, and a line with Retry', () => {
    render(<AlertHistory days={days} failed onRetry={() => {}} />);
    expect(
      screen.getByText("Couldn't refresh the history. This is what it last said.")
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('Show older, busy while it loads', async () => {
    const onMore = vi.fn();
    const { rerender } = render(<AlertHistory days={days} onMore={onMore} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show older' }));
    expect(onMore).toHaveBeenCalledOnce();
    rerender(<AlertHistory days={days} onMore={onMore} loadingMore />);
    expect(screen.getByRole('button', { name: 'Loading older…' })).toBeDisabled();
  });
});
