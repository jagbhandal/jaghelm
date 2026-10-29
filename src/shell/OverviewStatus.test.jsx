/*
 * The top of the desktop Overview (#297, #298): one attention panel with the
 * subsystem strip under it. Below 768px the web draws the phone screens
 * instead (#303), and the Phone board's split moved with them (#484), so it
 * is the same at any width the desktop Overview is drawn at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHONE_WIDTH } from '@ui/app-shell';
import { OverviewStatus } from './OverviewStatus.jsx';
import { HEALTHY, sixIssueIncident } from '../testing/statusFixtures.js';

const NOW = new Date('2026-10-20T09:00:00Z').getTime();

/** The poll's `updated` store, answered at `at`. */
function store(at) {
  return { get: () => at, subscribe: () => () => {}, staleAfter: 72_000 };
}

const panel = () => screen.getByRole('region', { name: 'Needs attention' });
const strip = () => screen.getByRole('region', { name: 'Subsystems' });
const rowsOf = (el) => el.querySelectorAll('[data-slot="issue-row"]');
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function renderStatus(status) {
  return render(<OverviewStatus status={status} reach="ok" updated={store(NOW)} />);
}

describe('the Overview’s status, from 768px (#484, #303)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is drawn from the shell’s own breakpoint (AppShell’s PHONE_WIDTH): 48rem, Tailwind’s md', () => {
    expect(PHONE_WIDTH).toBe('(width < 48rem)');
  });

  it('is one panel, its rows in it, the strip under it, whatever the window', () => {
    renderStatus(sixIssueIncident({ now: NOW }).status);
    expect(panel()).not.toHaveAttribute('data-layout');
    expect(panel().contains(strip())).toBe(false);
    expect(rowsOf(panel())).toHaveLength(6);
    expect(before(panel(), strip())).toBe(true);
  });

  it('takes the focus: All alerts, each row, then each tile', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderStatus(sixIssueIncident({ now: NOW }).status);
    const rows = [...rowsOf(panel())];
    expect(rows).toHaveLength(6);
    const tiles = [...strip().querySelectorAll('button')];
    expect(tiles.length).toBeGreaterThan(1);
    for (const el of [screen.getByRole('link', { name: /All alerts/ }), ...rows, ...tiles]) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('on a quiet board, the strip sits right under the quiet line', () => {
    renderStatus(HEALTHY);
    const line = screen.getByRole('region', { name: 'Status' });
    expect(line.nextElementSibling).toBe(strip().parentElement);
  });
});
