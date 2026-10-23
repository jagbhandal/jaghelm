import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { BeatSpace, UptimeBar, beatSummary } from '@ui/uptime-bar';
import { floatingLayer } from '@ui/lib/floating.jsx';

const beats = (bar) => [...bar.querySelectorAll('[data-slot="beat"]')];
const ups = (n) => Array.from({ length: n }, () => 'ok');

// The mock's Immich row: 30 beats, the last five down.
const IMMICH = [...ups(25), ...Array.from({ length: 5 }, () => 'crit')];

describe('beatSummary', () => {
  it("counts failures in the checks it has: '2 failures in the last 30 checks'", () => {
    expect(beatSummary([...ups(28), 'crit', 'ok'])).toBe('1 failure in the last 30 checks');
    expect(beatSummary([...ups(26), 'crit', 'ok', 'crit', 'ok'])).toBe(
      '2 failures in the last 30 checks'
    );
    expect(beatSummary(ups(30))).toBe('No failures in the last 30 checks');
    expect(beatSummary(['ok'])).toBe('No failures in the last check');
  });

  it('says when the latest check failed, and counts warnings apart from failures', () => {
    expect(beatSummary(IMMICH)).toBe('5 failures in the last 30 checks, including the latest');
    expect(beatSummary([...ups(27), 'warn', 'crit', 'ok'])).toBe(
      '1 failure and 1 warning in the last 30 checks'
    );
    expect(beatSummary([...ups(28), 'warn', 'warn'])).toBe('2 warnings in the last 30 checks');
  });

  it('counts only checks with data; maintenance is a check, not a failure', () => {
    expect(beatSummary([null, null, 'ok', 'crit', 'maintenance'])).toBe(
      '1 failure in the last 3 checks'
    );
    expect(beatSummary([null, undefined])).toBe('No checks yet');
    expect(beatSummary([])).toBe('No checks yet');
  });

  it('says a strip with no signal has no data, not that it has no checks', () => {
    expect(beatSummary(Array(30).fill('unknown'))).toBe('No data in the last 30 checks');
    expect(beatSummary([null, 'unknown'])).toBe('No data in the last check');
  });
});

describe('UptimeBar', () => {
  it('is an image named by its summary', () => {
    render(<UptimeBar beats={IMMICH} />);
    const bar = screen.getByRole('img', {
      name: 'Heartbeats: 5 failures in the last 30 checks, including the latest',
    });
    expect(bar).toHaveAttribute('data-slot', 'uptime-bar');
    expect(beats(bar)).toHaveLength(30);
  });

  it('takes a label for its name', () => {
    render(<UptimeBar beats={ups(12)} label="Immich heartbeats" />);
    expect(
      screen.getByRole('img', { name: 'Immich heartbeats: No failures in the last 12 checks' })
    ).toBeInTheDocument();
  });

  it('lights up only failures: crit and warn in their solids, every other beat quiet, no data hollow', () => {
    render(<UptimeBar beats={['ok', 'warn', 'crit', 'maintenance', 'unknown', null]} />);
    const [ok, warn, crit, maintenance, unknown, none] = beats(screen.getByRole('img'));
    expect(ok).toHaveClass('bg-beat-ok');
    expect(warn).toHaveClass('bg-warn-solid');
    expect(crit).toHaveClass('bg-crit-solid');
    // Planned work is not a failure (spec §6.1): it stays quiet.
    expect(maintenance).toHaveClass('bg-beat-ok');
    for (const empty of [unknown, none]) {
      expect(empty).toHaveClass('inset-ring', 'inset-ring-border-strong');
      expect(empty.className).not.toMatch(/(^|\s)bg-/);
    }
    expect(ok).toHaveAttribute('data-beat', 'ok');
    expect(none).toHaveAttribute('data-beat', 'none');
  });

  it("draws the mock's beats, oldest first: 4 × 16px, 2px round, 2px apart", () => {
    render(<UptimeBar beats={IMMICH} />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveClass('flex', 'gap-0.5');
    for (const b of beats(bar)) expect(b).toHaveClass('w-1', 'h-4', 'rounded-xs', 'shrink-0');
    expect(beats(bar).at(-1)).toHaveClass('bg-crit-solid');
    expect(beats(bar)[0]).toHaveClass('bg-beat-ok');
  });

  it("draws the drawers' larger beats: md 6 × 22px, lg 8 × 26px", () => {
    const { rerender } = render(<UptimeBar beats={ups(3)} size="md" />);
    for (const b of beats(screen.getByRole('img'))) expect(b).toHaveClass('w-1.5', 'h-5.5');
    rerender(<UptimeBar beats={ups(3)} size="lg" />);
    for (const b of beats(screen.getByRole('img'))) expect(b).toHaveClass('w-2', 'h-6.5');
  });

  it('pads the oldest end with empty beats to `count`, and keeps the newest', () => {
    const { rerender } = render(<UptimeBar beats={[...ups(11), 'crit']} count={30} />);
    let all = beats(screen.getByRole('img'));
    expect(all).toHaveLength(30);
    expect(all.slice(0, 18).every((b) => b.dataset.beat === 'none')).toBe(true);
    expect(all.at(-1)).toHaveAttribute('data-beat', 'crit');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Heartbeats: 1 failure in the last 12 checks, including the latest'
    );
    rerender(
      <UptimeBar beats={[...Array.from({ length: 20 }, () => 'crit'), ...ups(30)]} count={30} />
    );
    all = beats(screen.getByRole('img'));
    expect(all).toHaveLength(30);
    expect(all.every((b) => b.dataset.beat === 'ok')).toBe(true);
  });

  it('passes className and other props to its root', () => {
    render(<UptimeBar beats={ups(2)} className="justify-between" data-testid="beats" />);
    expect(screen.getByTestId('beats')).toHaveClass('justify-between', 'flex');
  });
});

// ── Checks as the server's strips give them (#312) ─────────────────────────

// Local times, so the HH:MM:SS reads the same in every time zone.
const at = (h, m, sec) => new Date(2026, 9, 23, h, m, sec).getTime();
const check = (word, state, time, ping = null) => ({ state, word, time, ping });
// Kuma's last four checks of a service: up, pending, down, then up again.
const CHECKS = [
  check('Up', 'ok', at(14, 31, 10), 138),
  check('Pending', 'warn', at(14, 31, 40)),
  check('Down', 'crit', at(14, 32, 10)),
  check('Up', 'ok', at(14, 32, 40), 141),
];
const tooltip = () => document.querySelector('[data-slot="uptime-bar-tooltip"]');

describe('UptimeBar with checks (#312)', () => {
  it('draws each check by its state, as a state is drawn: up, down, pending, maintenance, no data', () => {
    render(
      <UptimeBar
        beats={[
          check('Up', 'ok', at(9, 0, 0), 12),
          check('Down', 'crit', at(9, 0, 30)),
          check('Pending', 'warn', at(9, 1, 0)),
          check('Maintenance', 'maintenance', at(9, 1, 30)),
          check('No data', 'unknown', at(9, 2, 0)),
        ]}
      />
    );
    const bar = screen.getByRole('img');
    expect(beats(bar).map((b) => b.dataset.beat)).toEqual(['ok', 'crit', 'warn', 'maintenance', 'none']);
    const [up, down, pending, maintenance, none] = beats(bar);
    expect(up).toHaveClass('bg-beat-ok');
    expect(down).toHaveClass('bg-crit-solid');
    expect(pending).toHaveClass('bg-warn-solid');
    expect(maintenance).toHaveClass('bg-beat-ok');
    expect(none).toHaveClass('inset-ring-border-strong');
    expect(bar).toHaveAccessibleName('Heartbeats: 1 failure and 1 warning in the last 4 checks');
  });

  it('pads the oldest end with empty slots, never stretching the checks it has', () => {
    render(<UptimeBar beats={CHECKS} count={30} />);
    const all = beats(screen.getByRole('img'));
    expect(all).toHaveLength(30);
    expect(all.slice(0, 26).every((b) => b.dataset.beat === 'none' && !b.dataset.check)).toBe(true);
    expect(all.slice(26).map((b) => b.dataset.check)).toEqual(['0', '1', '2', '3']);
    for (const b of all) expect(b).toHaveClass('w-1', 'h-4');
  });

  it("shows the check under the pointer: its word, time and response time; none for padding or touch", async () => {
    render(<UptimeBar beats={CHECKS} count={6} />);
    const all = beats(screen.getByRole('img'));
    fireEvent.pointerMove(all[2], { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:31:10138 ms'));
    expect(tooltip()).toHaveAttribute('aria-hidden', 'true');
    expect(all[2]).toHaveAttribute('data-active');
    fireEvent.pointerMove(all[4], { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toHaveTextContent('Down14:32:10'));
    expect(tooltip()).not.toHaveTextContent('ms');
    fireEvent.pointerMove(all[0], { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toBeNull());
    fireEvent.pointerMove(all[5], { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:32:40141 ms'));
    fireEvent.pointerLeave(screen.getByRole('img'), { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toBeNull());
    fireEvent.pointerMove(all[5], { pointerType: 'touch' });
    await new Promise((r) => setTimeout(r, 20));
    expect(tooltip()).toBeNull();
  });

  it('stays out of the tab order unless focusable: a strip in a row that opens is no control', async () => {
    const user = userEvent.setup();
    render(<UptimeBar beats={CHECKS} />);
    await user.tab();
    expect(screen.getByRole('img')).not.toHaveFocus();
    expect(screen.getByRole('img')).not.toHaveAttribute('tabindex');
    expect(document.querySelector('[aria-live]')).toBeNull();
  });

  it('focusable: focus opens the newest check; arrows, Home and End move; Escape closes; a live region says each', async () => {
    const user = userEvent.setup();
    render(<UptimeBar beats={CHECKS} count={30} size="md" focusable />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveAccessibleDescription('The arrow keys read each check.');
    await user.tab();
    expect(bar).toHaveFocus();
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:32:40141 ms'));
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveClass('sr-only');
    expect(live.closest('[role="img"]')).toBeNull();

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tooltip()).toHaveTextContent('Down14:32:10'));
    expect(live).toHaveTextContent('Down at 14:32:10');
    await user.keyboard('{Home}');
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:31:10138 ms'));
    expect(live).toHaveTextContent('Up at 14:31:10, 138 ms');
    await user.keyboard('{ArrowLeft}');
    expect(live).toHaveTextContent('Up at 14:31:10, 138 ms');
    await user.keyboard('{End}');
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:32:40141 ms'));

    await user.keyboard('{Escape}');
    await waitFor(() => expect(tooltip()).toBeNull());
    expect(bar).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(tooltip()).toHaveTextContent('Down14:32:10'));
    await user.tab();
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  it('a strip of states has no tooltip and no keys, focusable or not', async () => {
    const user = userEvent.setup();
    render(<UptimeBar beats={ups(4)} focusable />);
    await user.tab();
    expect(screen.getByRole('img')).not.toHaveFocus();
    fireEvent.pointerMove(beats(screen.getByRole('img'))[1], { pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 20));
    expect(tooltip()).toBeNull();
  });
});

describe('UptimeBar: the static strip first, its tooltip with the floating layer (#312)', () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws the same strip before and after the layer's part arrives: nothing added to its box", async () => {
    const layer = floatingLayer.get();
    const get = vi.spyOn(floatingLayer, 'get').mockReturnValue(null);
    const { container, rerender } = render(<UptimeBar beats={CHECKS} count={30} />);
    const bar = screen.getByRole('img');
    const before = bar.outerHTML;
    expect(container.children).toHaveLength(1);
    fireEvent.pointerMove(beats(bar).at(-1), { pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 20));
    expect(tooltip()).toBeNull();

    get.mockReturnValue(layer);
    rerender(<UptimeBar beats={CHECKS} count={30} />);
    // The same element, the same markup: the part only listens on it.
    expect(screen.getByRole('img')).toBe(bar);
    expect(bar.outerHTML).toBe(before);
    expect(container.children).toHaveLength(1);
    fireEvent.pointerMove(beats(bar).at(-1), { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toHaveTextContent('Up14:32:40141 ms'));
    // The active beat's outline is the strip's own class, switched on by an attribute.
    expect(beats(bar).at(-1)).toHaveAttribute('data-active');
    expect(beats(bar).at(-1)).toHaveClass('data-active:outline-1');
  });

  it('asks for the layer when a pointer comes over a strip of checks, or it takes focus; never for a finger', () => {
    vi.spyOn(floatingLayer, 'get').mockReturnValue(null);
    const load = vi.spyOn(floatingLayer, 'loadQuietly').mockImplementation(() => {});
    const { rerender } = render(<UptimeBar beats={CHECKS} />);
    fireEvent.pointerEnter(screen.getByRole('img'), { pointerType: 'touch' });
    expect(load).not.toHaveBeenCalled();
    fireEvent.pointerEnter(screen.getByRole('img'), { pointerType: 'mouse' });
    expect(load).toHaveBeenCalledTimes(1);
    rerender(<UptimeBar beats={CHECKS} focusable />);
    fireEvent.focus(screen.getByRole('img'));
    expect(load).toHaveBeenCalledTimes(2);
    // A strip of states has no tooltip to load.
    rerender(<UptimeBar beats={ups(4)} />);
    fireEvent.pointerEnter(screen.getByRole('img'), { pointerType: 'mouse' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a check without a word is said in Kuma's word for its state", async () => {
    render(<UptimeBar beats={[{ state: 'warn', time: at(9, 0, 0), ping: null }]} />);
    fireEvent.pointerMove(beats(screen.getByRole('img'))[0], { pointerType: 'mouse' });
    await waitFor(() => expect(tooltip()).toHaveTextContent('Pending09:00:00'));
  });
});

describe('UptimeBar `fit`: narrower than its beats, it loses the oldest first (#312)', () => {
  it('lays the beats newest first from the right, one line tall, at least its newest 12 wide', () => {
    render(<UptimeBar beats={CHECKS} count={30} fit />);
    const bar = screen.getByRole('img');
    expect(bar).toHaveClass('flex-row-reverse', 'flex-wrap', 'overflow-hidden', 'h-4', 'min-w-[70px]');
    expect(bar).not.toHaveClass('w-fit');
    const all = beats(bar);
    expect(all).toHaveLength(30);
    // Newest first in the DOM, so a line too short wraps the oldest out of sight.
    expect(all.slice(0, 4).map((b) => b.dataset.check)).toEqual(['3', '2', '1', '0']);
    expect(all.slice(4).every((b) => b.dataset.beat === 'none' && !b.dataset.check)).toBe(true);
    expect(bar).toHaveAccessibleName('Heartbeats: 1 failure and 1 warning in the last 4 checks');
  });
});

describe('BeatSpace', () => {
  it("takes a strip's room, hidden: the same beats, invisible, out of the accessibility tree", () => {
    const { container } = render(<BeatSpace count={30} />);
    const space = container.querySelector('[data-slot="beat-space"]');
    expect(space).toHaveAttribute('aria-hidden', 'true');
    expect(space).toHaveClass('invisible', 'flex', 'gap-0.5');
    const slots = space.querySelectorAll('[data-slot="beat"]');
    expect(slots).toHaveLength(30);
    for (const b of slots) expect(b).toHaveClass('w-1', 'h-4', 'shrink-0');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
