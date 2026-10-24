/*
 * The expiry tracker (#676): what a server answer is drawn as against
 * Settings' lines (words and icon, never colour alone; no date is never
 * green), that nothing shows when nothing is set up, the Tailscale notices and
 * the one line for keys that never expire, and that the poll is the
 * component's own (mounted, hidden-aware, quicker while a target is checking).
 */
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { CHECKING_POLL_MS, EXPIRY_POLL_MS, expiryLines, expiryView, rowNote } from './expiry.js';
import Expiry from './Expiry.jsx';
import { ExpirySlot } from './ExpirySlot.jsx';

const mocks = vi.hoisted(() => ({ getExpiry: vi.fn() }));
vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getExpiry: mocks.getExpiry,
}));

const LINES = { warn: 21, crit: 7 };
const item = (name, state, daysLeft, extra = {}) => ({
  id: `tls:${name}`,
  source: 'tls',
  name,
  detail: 'Issued by Test CA',
  state,
  daysLeft,
  expires: daysLeft === null ? null : '2027-01-01T00:00:00.000Z',
  ...extra,
});
const answer = (items, extra = {}) => ({
  configured: true,
  items,
  noExpiry: null,
  tailscale: { configured: false },
  suggestions: [],
  ...extra,
});

describe('a row against the lines', () => {
  it('green at the warn line and over; amber under it; red under the crit line, with words for both', () => {
    const note = (d) => rowNote(item('a', 'ok', d), LINES);
    expect(note(60)).toMatchObject({ state: 'ok', text: '60 days left' });
    expect(note(21)).toMatchObject({ state: 'ok' });
    expect(note(20)).toMatchObject({ state: 'warn', said: '20 days left, warning' });
    expect(note(7)).toMatchObject({ state: 'warn' });
    expect(note(6)).toMatchObject({ state: 'crit', said: '6 days left, critical' });
    expect(note(1).text).toBe('1 day left');
    expect(note(0).text).toBe('Under 1 day left');
    expect(note(0).state).toBe('crit');
  });

  it('the lines move the colours', () => {
    const tight = { warn: 5, crit: 2 };
    expect(rowNote(item('a', 'ok', 6), tight).state).toBe('ok');
    expect(rowNote(item('a', 'ok', 4), tight).state).toBe('warn');
    expect(rowNote(item('a', 'ok', 1), tight).state).toBe('crit');
  });

  it('a certificate that does not cover the name is amber at best, never green, with the reason in words', () => {
    const n = rowNote(item('shop.example.com', 'ok', 60, { mismatch: true }), LINES);
    expect(n.state).toBe('warn');
    expect(n.text).toBe('60 days left, certificate does not cover shop.example.com');
    expect(n.said).toMatch(/warning$/);
    expect(rowNote(item('shop.example.com', 'ok', 3, { mismatch: true }), LINES).state).toBe('crit');
    expect(rowNote(item('shop.example.com', 'ok', 60, { mismatch: false }), LINES).state).toBe('ok');
  });

  it('expired is critical, said how long ago', () => {
    expect(rowNote(item('a', 'expired', -3), LINES)).toMatchObject({
      state: 'crit',
      text: 'Expired 3 days ago',
      said: 'Expired 3 days ago, critical',
    });
    expect(rowNote(item('a', 'expired', -1), LINES).text).toBe('Expired 1 day ago');
    expect(rowNote(item('a', 'expired', 0), LINES).text).toBe('Expired today');
  });

  it('no date is never green: unreachable, handshake failed, refused, unknown, even with a stray number', () => {
    for (const state of ['unreachable', 'handshake_failed', 'blocked', 'unknown', 'mystery']) {
      const n = rowNote(item('a', state, 400), LINES);
      expect(n.state, state).toBe('unknown');
      expect(n.text).not.toMatch(/days? left/);
    }
    expect(rowNote(item('a', 'unreachable', null), LINES).text).toBe('Unreachable');
    expect(rowNote(item('a', 'handshake_failed', null), LINES).text).toBe('Handshake failed');
    expect(rowNote(item('a', 'blocked', null), LINES).text).toBe('Refused by network setting');
    expect(rowNote(item('a', 'checking', null), LINES).state).toBe('checking');
    // An "ok" with no number is not a date either.
    expect(rowNote(item('a', 'ok', null), LINES).state).toBe('unknown');
  });
});

describe('what an answer is drawn as', () => {
  it('nothing without a target or a key, or before the first answer', () => {
    expect(expiryView(null)).toBeNull();
    expect(expiryView({})).toBeNull();
    expect(expiryView({ configured: false, items: [item('a', 'ok', 3)] })).toBeNull();
  });

  it('worst first: red, then amber and unknown, then checking, then fine; soonest first within', () => {
    const v = expiryView(
      answer([
        item('fine-late', 'ok', 300),
        item('fine-soon', 'ok', 40),
        item('checking', 'checking', null),
        item('amber', 'ok', 15),
        item('down', 'unreachable', null),
        item('red', 'ok', 2),
        item('gone', 'expired', -4),
      ]),
      LINES
    );
    expect(v.rows.map((r) => r.name)).toEqual([
      'gone',
      'red',
      'amber',
      'down',
      'checking',
      'fine-soon',
      'fine-late',
    ]);
    expect(v.tracked).toBe(7);
  });

  it('Tailscale: keys that never expire are one line, a rejected key is a notice that says tokens expire', () => {
    const v = expiryView(
      answer([], {
        noExpiry: { count: 3, names: ['a', 'b', 'c'] },
        tailscale: { configured: true, state: 'rejected' },
      }),
      LINES
    );
    expect(v.noExpiry).toEqual({ count: 3, names: ['a', 'b', 'c'] });
    expect(v.notices).toHaveLength(1);
    expect(v.notices[0].text).toMatch(/Tailscale key rejected/);
    expect(v.notices[0].text).toMatch(/90 days at most/);
    expect(expiryView(answer([], { tailscale: { configured: true, state: 'unreachable' } })).notices).toHaveLength(1);
    expect(expiryView(answer([], { tailscale: { configured: true, state: 'ok', stale: true } })).notices[0].text).toMatch(/last known/);
    expect(expiryView(answer([], { tailscale: { configured: true, state: 'ok' } })).notices).toEqual([]);
    expect(expiryView(answer([], { noExpiry: { count: 0, names: [] } })).noExpiry).toBeNull();
  });

  it('offline Tailscale devices are muted lines, out of the rows', () => {
    const v = expiryView(
      answer([item('a.example.com', 'ok', 30)], { offline: [{ name: 'old-laptop', lastSeen: '2026-08-01T10:00:00.000Z' }] }),
      LINES
    );
    expect(v.rows).toHaveLength(1);
    expect(v.offline).toEqual([{ key: '0-old-laptop', text: 'old-laptop: offline since 2026-08-01, key expired' }]);
    expect(v.tracked).toBe(1);
  });

  it('junk in the answer never throws', () => {
    const v = expiryView(
      { configured: true, items: [null, 7, { name: 5 }, item('ok', 'ok', 30)], noExpiry: 'x', tailscale: 9 },
      LINES
    );
    expect(v.rows.map((r) => r.name)).toEqual(['ok']);
    expect(expiryView({ configured: true, items: 'no' }).rows).toEqual([]);
  });

  it('the lines are Settings: a saved pair, else 21 and 7', () => {
    expect(expiryLines({})).toEqual({ warn: 21, crit: 7 });
    expect(expiryLines({ expiryDays: { warn: 60, crit: 30 } })).toEqual({ warn: 60, crit: 30 });
    // The pair wins over the earlier separate keys; a pair that is no pair falls back to them.
    expect(expiryLines({ expiryDays: { warn: 60, crit: 30 }, expiryWarnDays: 9, expiryCritDays: 2 })).toEqual({ warn: 60, crit: 30 });
    expect(expiryLines({ expiryDays: { warn: 5, crit: 9 }, expiryWarnDays: 40, expiryCritDays: 10 })).toEqual({ warn: 40, crit: 10 });
    expect(expiryLines({ expiryWarnDays: 60, expiryCritDays: 30 })).toEqual({ warn: 60, crit: 30 });
  });
});

describe('the section', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getExpiry.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const mount = async (ui, config = {}) => {
    const out = render(
      <ConfigProvider config={config} setConfig={() => {}}>
        {ui}
      </ConfigProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return out;
  };

  it('draws each item with its icon, words and source, soonest first', async () => {
    mocks.getExpiry.mockResolvedValue(
      answer([item('a.example.com', 'ok', 5), item('b.example.com', 'ok', 90, { source: 'tailscale', detail: 'Tailscale node key' })])
    );
    await mount(<Expiry />);
    const section = screen.getByRole('region', { name: 'Expiry' });
    expect(within(section).getByText('2 tracked')).toBeInTheDocument();
    const rows = within(section).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('a.example.com');
    expect(rows[0]).toHaveTextContent('Issued by Test CA');
    expect(rows[0]).toHaveTextContent('5 days left, critical');
    expect(rows[0].getAttribute('data-state')).toBe('crit');
    expect(rows[0].querySelector('svg')).not.toBeNull();
    expect(rows[1]).toHaveTextContent('Tailscale');
  });

  it('follows the lines Settings saved', async () => {
    mocks.getExpiry.mockResolvedValue(answer([item('a.example.com', 'ok', 30)]));
    await mount(<Expiry />, { expiryDays: { warn: 60, crit: 31 } });
    expect(screen.getByRole('listitem').getAttribute('data-state')).toBe('crit');
  });

  it('draws nothing with nothing set up', async () => {
    mocks.getExpiry.mockResolvedValue({ configured: false, items: [], suggestions: ['x.example.com'] });
    const { container } = await mount(<Expiry />);
    expect(container).toBeEmptyDOMElement();
  });

  it('one line for key-expiry-off devices, naming them on hover', async () => {
    mocks.getExpiry.mockResolvedValue(
      answer([], { noExpiry: { count: 2, names: ['srv1', 'srv2'] }, tailscale: { configured: true, state: 'ok' } })
    );
    await mount(<Expiry />);
    const line = screen.getByText(/2 Tailscale devices have key expiry off/);
    expect(line).toHaveAttribute('title', 'srv1, srv2');
  });

  it('on a phone shows four rows and a button for the rest', async () => {
    const items = Array.from({ length: 7 }, (_, i) => item(`h${i}.example.com`, 'ok', 100 + i));
    mocks.getExpiry.mockResolvedValue(answer(items));
    await mount(<Expiry phone />);
    expect(screen.getAllByText(/\.example\.com/)).toHaveLength(4);
    const more = screen.getByRole('button', { name: 'Show 3 more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await act(async () => {
      more.click();
    });
    expect(screen.getAllByText(/\.example\.com/)).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('reads on mount and every 30 minutes, keeps the last answer through a failed read', async () => {
    mocks.getExpiry.mockResolvedValue(answer([item('a.example.com', 'ok', 30)]));
    await mount(<Expiry />);
    expect(mocks.getExpiry).toHaveBeenCalledTimes(1);
    mocks.getExpiry.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPIRY_POLL_MS);
    });
    expect(mocks.getExpiry).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Expiry' })).toBeInTheDocument();
  });

  it('asks again within seconds while a target is still being checked, then settles', async () => {
    mocks.getExpiry.mockResolvedValueOnce(answer([item('new.example.com', 'checking', null)]));
    mocks.getExpiry.mockResolvedValue(answer([item('new.example.com', 'ok', 80)]));
    await mount(<Expiry />);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECKING_POLL_MS + 100);
    });
    expect(mocks.getExpiry).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('80 days left').length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mocks.getExpiry).toHaveBeenCalledTimes(2);
  });

  it('the slot loads the chunk and draws it; unmounted, nothing is asked', async () => {
    mocks.getExpiry.mockResolvedValue(answer([item('slot.example.com', 'ok', 30)]));
    const { unmount } = await mount(<ExpirySlot />);
    expect(mocks.getExpiry).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText('slot.example.com')).toBeInTheDocument();
    unmount();
    mocks.getExpiry.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * EXPIRY_POLL_MS);
    });
    expect(mocks.getExpiry).not.toHaveBeenCalled();
  });
});
