import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { StatusLamp } from '@ui/status-lamp';
import { ShellHeader } from './ShellChrome.jsx';
import { staleAfterMs } from '../hooks/useStatus.js';
import { DEGRADED, FIRST_RUN, HEALTHY, INCIDENT, NO_SIGNAL } from '../testing/statusFixtures.js';

// The header (#296, #275): the model's state and sentence, with its counts;
// steel "No signal" without a backend; and "updated Xs ago" ticking on its own,
// re-rendering nothing else.

// Count the lamp's renders: the header draws it in every state, so a render
// of the header is a render of the lamp.
vi.mock('@ui/status-lamp', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, StatusLamp: vi.fn((props) => real.StatusLamp(props)) };
});

// The poll's store at the default 30 s interval: stale 72 s after its answer.
const STALE_AFTER = staleAfterMs(30_000);

function store(at) {
  let value = at;
  const listeners = new Set();
  return {
    staleAfter: STALE_AFTER,
    get: () => value,
    set(v) {
      value = v;
      for (const l of [...listeners]) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const NOW = new Date('2026-10-20T09:00:00Z').getTime();

function renderHeader(props) {
  const updated = store(NOW);
  const tree = (more) => (
    <UiRoot>
      <ShellHeader
        name="JagHelm"
        routeId="overview"
        onOpenPalette={() => {}}
        updated={updated}
        {...props}
        {...more}
      />
    </UiRoot>
  );
  const view = render(tree());
  return { ...view, updated, rerender: (more) => view.rerender(tree(more)) };
}

// The header's status: the link, and beside it the live region that announces it.
const place = () => document.querySelector('[data-slot="header-status"]');
const live = () => screen.getByRole('status');
const link = () =>
  screen.getByRole('link', { name: /^(Critical|Warning|No signal|All systems|Nothing monitored)/ });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  StatusLamp.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the header says what the status model says', () => {
  it('an incident: the word and the sentence, with its counts, a link to Alerts', () => {
    renderHeader({ status: INCIDENT, reach: 'ok' });
    expect(INCIDENT.overall.sentence).toBe(
      '1 service down · UPS on battery · 1 node in warning · 1 no signal'
    );
    expect(link()).toHaveAccessibleName(`Critical: ${INCIDENT.overall.sentence}`);
    expect(link()).toHaveAttribute('href', '/alerts');
    expect(link()).toHaveAttribute('data-state', 'crit');
    expect(live()).toHaveTextContent(`Critical: ${INCIDENT.overall.sentence}`);
  });

  it('degraded: Warning, and the counts', () => {
    renderHeader({ status: DEGRADED, reach: 'ok' });
    expect(link()).toHaveAccessibleName('Warning: 1 node in warning');
    expect(link()).toHaveAttribute('data-state', 'warn');
  });

  it('entities with no signal: steel No signal, and the counts', () => {
    renderHeader({ status: NO_SIGNAL, reach: 'ok' });
    expect(link()).toHaveAccessibleName('No signal: 1 up · 1 no signal');
    expect(link()).toHaveAttribute('data-state', 'unknown');
  });

  it('healthy: the quiet line, never a green word', () => {
    renderHeader({ status: HEALTHY, reach: 'ok' });
    expect(link()).toHaveAccessibleName('All systems normal: 1 service up · 2 nodes healthy');
    expect(link()).toHaveAttribute('data-state', 'ok');
    expect(screen.getByText('All systems normal')).not.toHaveClass('text-ok-fg');
  });

  // #449: nothing is set up, so nothing is wrong and nothing is silent.
  it('first run, nothing monitored yet: the quiet line with no lamp, never the No signal alarm', () => {
    renderHeader({ status: FIRST_RUN, reach: 'ok' });
    expect(FIRST_RUN.overall).toEqual({ state: 'empty', sentence: 'Nothing monitored yet' });
    expect(link()).toHaveAccessibleName('Nothing monitored yet');
    expect(link()).toHaveAttribute('href', '/alerts');
    expect(link()).toHaveAttribute('data-state', 'empty');
    expect(within(link()).getByText('Nothing monitored yet')).toHaveClass('text-text-1');
    // Said once: the model's sentence is the whole line.
    expect(within(link()).getAllByText('Nothing monitored yet')).toHaveLength(1);
    // No state, so no lamp: no steel ring, no "No signal", no status colour.
    expect(place().querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(screen.queryByText('No signal')).toBeNull();
    expect(screen.queryByText('All systems normal')).toBeNull();
    expect(place().querySelector('[data-slot="status-word"]')).toBeNull();
  });

  // #480: what it last said stays, as last known, never in its colour.
  it('the backend unreachable: steel "No signal", and what it last knew, how long ago', () => {
    renderHeader({ status: INCIDENT, reach: 'down' });
    expect(link()).toHaveAccessibleName(
      'No signal: last known just now: Critical · 2 critical, 1 warning, 1 no signal'
    );
    expect(link()).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByText('No signal')).toHaveClass('text-unknown-fg');
    expect(place().querySelector('[data-slot="status-lamp"]')).toHaveAttribute(
      'data-state',
      'unknown'
    );
    // Its age moves on while the polls fail, as "Updated" does.
    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(link()).toHaveAccessibleName(/^No signal: last known 3 min ago: Critical/);
    expect(screen.getByText('Updated 3 min ago')).toBeInTheDocument();
  });

  it('healthy, then unreachable: never "All systems normal" on its own, never a green lamp', () => {
    renderHeader({ status: HEALTHY, reach: 'down' });
    expect(link()).toHaveAccessibleName('No signal: last known just now: All systems normal');
    expect(link()).toHaveAttribute('data-state', 'unknown');
    expect(place().querySelector('[data-state="ok"]')).toBeNull();
  });

  it('a 503 after a status (past its TTL): No signal, what it last knew', () => {
    renderHeader({ status: DEGRADED, reach: 'waiting' });
    expect(link()).toHaveAccessibleName('No signal: last known just now: Warning · 1 warning');
  });

  it('nothing known, the backend unreachable: No signal, and why', () => {
    renderHeader({ status: null, reach: 'down', updated: store(null) });
    expect(link()).toHaveAccessibleName("No signal: Can't reach JagHelm");
  });

  it('no status yet (503): No signal, waiting', () => {
    renderHeader({ status: null, reach: 'waiting' });
    expect(link()).toHaveAccessibleName('No signal: Waiting for the first check');
  });

  it('before the first answer: a placeholder, not No signal', () => {
    renderHeader({ status: null, reach: 'loading' });
    expect(live()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No signal')).toBeNull();
  });

  // #480 review: a hidden tab or a sleeping laptop asks nothing, so the poll's
  // reach stays 'ok' while its status grows old.
  it('no answer for longer than the poll allows: No signal and what it last knew, though the poll still says ok', () => {
    renderHeader({ status: INCIDENT, reach: 'ok' });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER - 1);
    });
    expect(link()).toHaveAttribute('data-state', 'crit');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(link()).toHaveAccessibleName(
      'No signal: last known 1 min ago: Critical · 2 critical, 1 warning, 1 no signal'
    );
    expect(link()).toHaveAttribute('data-state', 'unknown');
    expect(live()).toHaveTextContent("No signal: JagHelm's status is out of date");
  });

  it('marks the link current on the Alerts page', () => {
    renderHeader({ status: INCIDENT, reach: 'ok', routeId: 'alerts' });
    expect(link()).toHaveAttribute('aria-current', 'page');
  });
});

// #480 review: the age moves each second under No signal; a screen reader
// hears the header change state, never the age tick.
describe('the live region announces a change of state, never a tick of the age', () => {
  it('fresh, No signal while the age moves, and back', () => {
    const { rerender, updated } = renderHeader({ status: INCIDENT, reach: 'ok' });
    const region = live();
    expect(region).toHaveTextContent(`Critical: ${INCIDENT.overall.sentence}`);
    expect(region).not.toContainElement(link());

    rerender({ reach: 'down' });
    expect(live()).toBe(region);
    const stale = "No signal: Can't reach JagHelm";
    expect(region).toHaveTextContent(stale);
    const said = [region.textContent];
    for (const ms of [1_000, 11_000, 48_000, 3 * 60_000]) {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
      said.push(region.textContent);
    }
    // The link's age moved on; the region said nothing new.
    expect(link()).toHaveAccessibleName(/^No signal: last known 4 min ago: Critical/);
    expect(new Set(said)).toEqual(new Set([stale]));

    // The answer that brings the signal back.
    act(() => {
      updated.set(Date.now());
    });
    rerender({ reach: 'ok' });
    expect(region).toHaveTextContent(`Critical: ${INCIDENT.overall.sentence}`);
  });

  it('the first status after the placeholder is a change of the same region', () => {
    const { rerender } = renderHeader({ status: null, reach: 'loading' });
    const region = live();
    expect(region).toHaveTextContent('Checking status');
    rerender({ status: HEALTHY, reach: 'ok' });
    expect(live()).toBe(region);
    expect(region).not.toHaveAttribute('aria-busy');
    expect(region).toHaveTextContent('All systems normal: 1 service up · 2 nodes healthy');
  });
});

describe('"updated Xs ago" ticks on its own', () => {
  it('re-renders nothing else: the lamp renders once while the clock runs and answers come', () => {
    const updated = store(NOW);
    renderHeader({ status: INCIDENT, reach: 'ok', updated });
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    const renders = StatusLamp.mock.calls.length;
    expect(renders).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByText('Updated 12 s ago')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(48_000);
    });
    expect(screen.getByText('Updated 1 min ago')).toBeInTheDocument();
    // A poll answered (a 304: the same status): only the clock moves.
    act(() => {
      updated.set(Date.now());
    });
    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    expect(StatusLamp.mock.calls.length).toBe(renders);
  });

  it('shows nothing before the first answer', () => {
    renderHeader({ status: null, reach: 'loading', updated: store(null) });
    expect(screen.queryByText(/^Updated/)).toBeNull();
  });
});

// #569: below 768px the header is the Phone board's (PhoneHeader), the status
// the Overview's card's; its live region still announces a change, by the
// same freshness rule as the desktop header's.
describe('on a phone, the Phone board’s header', () => {
  it('the logo, the name and the theme toggle; no status word, search or Settings', () => {
    renderHeader({ status: INCIDENT, reach: 'ok', phone: true, onThemeChange: () => {} });
    const banner = screen.getByRole('banner');
    expect(banner).toHaveAttribute('data-slot', 'phone-header');
    expect(
      within(banner)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual(['/']);
    expect(
      within(banner)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label'))
    ).toEqual(['Switch to light theme']);
    expect(place()).toBeNull();
    expect(screen.queryByText(/^Updated/)).toBeNull();
    expect(live()).toHaveTextContent(`Critical: ${INCIDENT.overall.sentence}`);
  });

  it('announces No signal by the same rule: the status out of date though the poll says ok', () => {
    renderHeader({ status: INCIDENT, reach: 'ok', phone: true });
    act(() => {
      vi.advanceTimersByTime(STALE_AFTER);
    });
    expect(live()).toHaveTextContent("No signal: JagHelm's status is out of date");
  });
});
