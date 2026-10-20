import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { UptimeBar, beatSummary } from '@ui/uptime-bar';

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
    expect(beatSummary([null, 'unknown', undefined])).toBe('No checks yet');
    expect(beatSummary([])).toBe('No checks yet');
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
