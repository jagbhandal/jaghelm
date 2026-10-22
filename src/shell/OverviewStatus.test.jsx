/*
 * The top of the Overview at phone width (#484): below 768px the attention
 * panel is drawn in two parts with the subsystem strip between them, as the
 * Phone board orders it (status card, strip, issue list); from 768px it is one
 * panel with the strip under it, as before. The width is the window's, by the
 * shell's own breakpoint (md, 48rem), and a resize across it moves the strip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverviewStatus, PHONE_WIDTH } from './OverviewStatus.jsx';
import { HEALTHY, INCIDENT, sixIssueIncident } from '../testing/statusFixtures.js';

const NOW = new Date('2026-10-20T09:00:00Z').getTime();

/** The poll's `updated` store, answered at `at`. */
function store(at) {
  return { get: () => at, subscribe: () => () => {}, staleAfter: 72_000 };
}

/** window.matchMedia with the phone width matching or not, and a way to resize. */
function windowWidth(phone) {
  const listeners = new Set();
  let matches = phone;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query,
    get matches() {
      return query === PHONE_WIDTH && matches;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  return {
    resize(toPhone) {
      matches = toPhone;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

const panel = () => screen.getByRole('region', { name: 'Needs attention' });
const strip = () => screen.getByRole('region', { name: 'Subsystems' });
const rowsOf = (el) => el.querySelectorAll('[data-slot="issue-row"]');
const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function renderStatus(status) {
  return render(<OverviewStatus status={status} reach="ok" updated={store(NOW)} />);
}

describe('the Overview’s status at phone width (#484)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is the shell’s breakpoint: below 48rem, as md switches the tabs and the sidebar', () => {
    expect(PHONE_WIDTH).toBe('(width < 48rem)');
  });

  it('below 768px: the header, then the strip, then the issue rows, in one panel', () => {
    windowWidth(true);
    const status = sixIssueIncident({ now: NOW }).status;
    expect(status.issues).toHaveLength(6);
    renderStatus(status);
    const header = panel().querySelector('[data-slot="attention-panel-header"]');
    const rows = panel().querySelector('[data-slot="attention-panel-rows"]');
    expect(panel()).toHaveAttribute('data-layout', 'split');
    expect(panel().contains(strip())).toBe(true);
    expect(before(header, strip())).toBe(true);
    expect(before(strip(), rows)).toBe(true);
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Critical · 6 critical'
    );
    expect(rowsOf(rows)).toHaveLength(6);
    expect(rowsOf(header)).toHaveLength(0);
  });

  it('from 768px: one panel, its rows in it, the strip under it, as before', () => {
    windowWidth(false);
    renderStatus(sixIssueIncident({ now: NOW }).status);
    expect(panel()).not.toHaveAttribute('data-layout');
    expect(panel().contains(strip())).toBe(false);
    expect(rowsOf(panel())).toHaveLength(6);
    expect(before(panel(), strip())).toBe(true);
  });

  it('follows the window across 768px', () => {
    const win = windowWidth(false);
    renderStatus(INCIDENT);
    expect(panel().contains(strip())).toBe(false);
    win.resize(true);
    expect(panel()).toHaveAttribute('data-layout', 'split');
    expect(panel().contains(strip())).toBe(true);
    win.resize(false);
    expect(panel()).not.toHaveAttribute('data-layout');
    expect(panel().contains(strip())).toBe(false);
  });

  it('below 768px, takes the focus: All alerts, each tile, then each row', async () => {
    windowWidth(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const status = sixIssueIncident({ now: NOW }).status;
    renderStatus(status);
    const tiles = within(strip()).getAllByRole('button');
    expect(tiles.length).toBeGreaterThan(1);
    // No board here, so the rows open nothing: plain content, never focused.
    // The order up to them is the point: All alerts, then every tile.
    const order = [screen.getByRole('link', { name: /All alerts/ }), ...tiles];
    for (const el of order) {
      await user.tab();
      expect(el).toHaveFocus();
    }
  });

  it('on a quiet board, the strip sits right under the quiet line, at any width', () => {
    for (const phone of [true, false]) {
      windowWidth(phone);
      const { unmount } = renderStatus(HEALTHY);
      const line = screen.getByRole('region', { name: 'Status' });
      expect(line.nextElementSibling).toBe(strip().parentElement);
      unmount();
      vi.restoreAllMocks();
    }
  });
});
