/*
 * The pending host steps (#673): what a server answer is drawn as, that
 * nothing shows without a Gitea or with no step open, that a list that could
 * not be read is one quiet link to #848, and that the poll is the component's
 * own (mounted, hidden-aware), a read on load and one every 5 minutes.
 */
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_ACTIONS_POLL_MS, hostActionsView } from './hostActions.js';
import HostActions from './HostActions.jsx';
import { HostActionsSlot } from './HostActionsSlot.jsx';

const mocks = vi.hoisted(() => ({ getHostActions: vi.fn() }));
vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHostActions: mocks.getHostActions,
}));

const HREF = 'https://git.example/jagdeep.bhandal/homelab-infra/issues/848';
const row = (n, extra = {}) => ({
  ref: `#${n}`,
  title: `step ${n}`,
  href: `https://git.example/jagdeep.bhandal/homelab-infra/issues/${n}`,
  ...extra,
});
const list = (count, items = [row(1), row(2)], extra = {}) => ({
  configured: true,
  ok: true,
  count,
  items,
  more: count - items.length,
  href: HREF,
  ...extra,
});

describe('what an answer is drawn as', () => {
  it('nothing without a Gitea, before the first answer, or with no step open', () => {
    expect(hostActionsView(null)).toBeNull();
    expect(hostActionsView({})).toBeNull();
    expect(hostActionsView({ configured: false })).toBeNull();
    expect(hostActionsView(list(0, []))).toBeNull();
  });

  it('a list: the count, a link per row, and the rest counted', () => {
    const v = hostActionsView(list(5));
    expect(v).toMatchObject({ kind: 'list', count: 5, more: 3, stale: false });
    expect(v.rows.map((r) => r.href)).toEqual([row(1).href, row(2).href]);
  });

  it('a list that could not be read is the link to #848, never a count', () => {
    expect(hostActionsView({ configured: true, ok: false, href: HREF })).toEqual({
      kind: 'unreadable',
      href: HREF,
    });
  });

  it('an address the browser would not open is left out; junk in the answer never throws', () => {
    const v = hostActionsView(
      list(2, [row(1, { href: 'javascript:alert(1)' }), null, 'x', row(2)])
    );
    expect(v.rows[0].href).toBe(HREF);
    expect(v.rows).toHaveLength(2);
    expect(hostActionsView({ configured: true, ok: true, count: 'many', items: 7 })).toBeNull();
  });
});

describe('the section', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getHostActions.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const mount = async (ui) => {
    const out = render(ui);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return out;
  };

  it('draws the count and a link out to each step in Gitea', async () => {
    mocks.getHostActions.mockResolvedValue(list(2));
    await mount(<HostActions />);
    const section = screen.getByRole('region', { name: 'Pending host steps' });
    expect(within(section).getByText('2')).toBeInTheDocument();
    const link = within(section).getByRole('link', { name: /#1\s+step 1/ });
    expect(link).toHaveAttribute('href', row(1).href);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('draws nothing with none open or no Gitea set up', async () => {
    mocks.getHostActions.mockResolvedValue({ configured: false });
    const { container } = await mount(<HostActions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says it could not read the list, with the link to #848', async () => {
    mocks.getHostActions.mockResolvedValue({ configured: true, ok: false, href: HREF });
    await mount(<HostActions />);
    expect(screen.getByText(/couldn't read the list/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /See #848/ })).toHaveAttribute('href', HREF);
  });

  it('on a phone shows three rows, then how many more and the link to #848', async () => {
    const items = [1, 2, 3, 4].map((n) => row(n));
    mocks.getHostActions.mockResolvedValue(list(6, items));
    await mount(<HostActions phone />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4); // three rows and the "more" line
    expect(screen.getByRole('link', { name: /\+ 3 more in #848/ })).toHaveAttribute('href', HREF);
  });

  it('says it is last known while Gitea is not answering', async () => {
    mocks.getHostActions.mockResolvedValue(list(2, [row(1), row(2)], { stale: true }));
    await mount(<HostActions />);
    expect(screen.getByText(/Last known/)).toBeInTheDocument();
  });

  it('reads on mount and every 5 minutes after, keeps the last answer through a failed read', async () => {
    mocks.getHostActions.mockResolvedValue(list(2));
    await mount(<HostActions />);
    expect(mocks.getHostActions).toHaveBeenCalledTimes(1);
    mocks.getHostActions.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_ACTIONS_POLL_MS);
    });
    expect(mocks.getHostActions).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Pending host steps' })).toBeInTheDocument();
  });

  it('the slot loads the chunk and draws it; unmounted, nothing is asked', async () => {
    mocks.getHostActions.mockResolvedValue(list(1, [row(7)]));
    const { unmount } = render(<HostActionsSlot />);
    // Nothing is mounted, so nothing asked, until the browser is idle.
    expect(mocks.getHostActions).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByRole('link', { name: /#7/ })).toBeInTheDocument();
    unmount();
    mocks.getHostActions.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * HOST_ACTIONS_POLL_MS);
    });
    expect(mocks.getHostActions).not.toHaveBeenCalled();
  });
});
