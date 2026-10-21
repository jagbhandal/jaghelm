import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { StatusLamp } from '@ui/status-lamp';
import { ShellHeader } from './ShellChrome.jsx';
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

function store(at) {
  let value = at;
  const listeners = new Set();
  return {
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
  return render(
    <UiRoot>
      <ShellHeader
        name="JagHelm"
        routeId="overview"
        onOpenPalette={() => {}}
        updated={store(NOW)}
        {...props}
      />
    </UiRoot>
  );
}

const status = () => screen.getByRole('status');
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
    expect(status()).toContainElement(link());
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
    expect(screen.getByText('Nothing monitored yet')).toHaveClass('text-text-1');
    // Said once: the model's sentence is the whole line.
    expect(within(status()).getAllByText('Nothing monitored yet')).toHaveLength(1);
    // No state, so no lamp: no steel ring, no "No signal", no status colour.
    expect(status().querySelector('[data-slot="status-lamp"]')).toBeNull();
    expect(screen.queryByText('No signal')).toBeNull();
    expect(screen.queryByText('All systems normal')).toBeNull();
    expect(status().querySelector('[data-slot="status-word"]')).toBeNull();
  });

  // #480: what it last said stays, as last known, never in its colour.
  it('the backend unreachable: steel "No signal", and what it last knew, how long ago', () => {
    renderHeader({ status: INCIDENT, reach: 'down' });
    expect(link()).toHaveAccessibleName(
      'No signal: last known just now: Critical · 2 critical, 1 warning, 1 no signal'
    );
    expect(link()).toHaveAttribute('data-state', 'unknown');
    expect(screen.getByText('No signal')).toHaveClass('text-unknown-fg');
    expect(status().querySelector('[data-slot="status-lamp"]')).toHaveAttribute(
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
    expect(status().querySelector('[data-state="ok"]')).toBeNull();
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
    expect(status()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No signal')).toBeNull();
  });

  it('marks the link current on the Alerts page', () => {
    renderHeader({ status: INCIDENT, reach: 'ok', routeId: 'alerts' });
    expect(link()).toHaveAttribute('aria-current', 'page');
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
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(screen.getByText('Updated 3 min ago')).toBeInTheDocument();
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
