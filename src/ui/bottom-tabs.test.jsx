import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Bell, Ellipsis, LayoutDashboard } from 'lucide-react';
import { BottomTabs } from '@ui/bottom-tabs';

const tabs = ({ onMore = vi.fn(), expanded = false } = {}) => [
  { id: 'overview', label: 'Overview', href: '/', icon: <LayoutDashboard aria-hidden="true" /> },
  {
    id: 'alerts',
    label: 'Alerts',
    href: '/alerts',
    icon: <Bell aria-hidden="true" />,
    current: true,
    badge: { count: 4, state: 'crit', label: '4 issues' },
  },
  {
    id: 'more',
    label: 'More',
    icon: <Ellipsis aria-hidden="true" />,
    onClick: onMore,
    expanded,
  },
];

const bar = () => screen.getByRole('navigation', { name: 'Tabs' });

describe('BottomTabs', () => {
  it('is the Tabs navigation: links for pages, the open one aria-current', () => {
    render(<BottomTabs tabs={tabs()} />);
    const overview = within(bar()).getByRole('link', { name: 'Overview' });
    const alerts = within(bar()).getByRole('link', { name: 'Alerts, 4 issues' });
    expect(overview).toHaveAttribute('href', '/');
    expect(overview).not.toHaveAttribute('aria-current');
    expect(overview).toHaveClass('text-text-3');
    expect(alerts).toHaveAttribute('aria-current', 'page');
    expect(alerts).toHaveClass('text-accent-text');
  });

  it("draws a count in the state's solid", () => {
    render(<BottomTabs tabs={tabs()} />);
    const badge = bar().querySelector('[data-slot="tab-badge"]');
    expect(badge).toHaveTextContent('4');
    expect(badge).toHaveClass('bg-crit-solid', 'text-crit-on-solid');
  });

  it('More is a button that opens a sheet, saying whether it is open', async () => {
    const user = userEvent.setup();
    const onMore = vi.fn();
    const { rerender } = render(<BottomTabs tabs={tabs({ onMore })} />);
    const more = within(bar()).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(onMore).toHaveBeenCalledOnce();
    rerender(<BottomTabs tabs={tabs({ onMore, expanded: true })} />);
    expect(more).toHaveAttribute('aria-expanded', 'true');
  });

  it('hands a link click to onNavigate with its href', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn((e) => e.preventDefault());
    render(<BottomTabs tabs={tabs()} onNavigate={onNavigate} />);
    await user.click(within(bar()).getByRole('link', { name: 'Overview' }));
    expect(onNavigate).toHaveBeenCalledWith(expect.anything(), '/');
  });
});
