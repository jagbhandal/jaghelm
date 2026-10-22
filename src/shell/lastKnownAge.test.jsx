import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import { UiRoot } from '@ui/root';
import { ShellHeader } from './ShellChrome.jsx';
import { ShellAttention } from './ShellAttention.jsx';
import { useStatus } from '../hooks/useStatus.js';
import { INCIDENT } from '../testing/statusFixtures.js';

// #499: under No signal, the header and the attention panel say how old the
// status is, counting from when the server built it (its Last-Modified), not
// from the poll's last answer, which after a TTL 503 is younger than the
// status. The real poll (useStatus) feeds both, as the shell wires them.

const INTERVAL = 30_000;
const NOW = new Date('2026-10-22T09:00:00Z').getTime();

let answer;

function respond(body, { status = 200, modified = null } = {}) {
  const headers = { etag: '"v1"', 'last-modified': modified };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

const expired = () => respond({ error: 'Status not yet available' }, { status: 503 });

function Board() {
  const poll = useStatus({ intervalMs: INTERVAL });
  return (
    <UiRoot>
      <ShellHeader name="JagHelm" routeId="overview" onOpenPalette={() => {}} {...poll} />
      <ShellAttention status={poll.status} reach={poll.reach} updated={poll.updated} />
    </UiRoot>
  );
}

const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));
const headerLink = () =>
  within(screen.getByRole('banner')).getByRole('link', { name: /^(Critical|No signal)/ });
const panelHeading = () =>
  within(screen.getByRole('region', { name: 'Needs attention' })).getByRole('heading', {
    level: 2,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // Each poll is a full answer: the ETag this stub sends is never asked about.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(answer()))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('"last known" under No signal, header and panel (#499)', () => {
  it('after a TTL 503, counts from when the status was built, not from the last answer', async () => {
    // The answer at NOW carries a status the server built 25 s before.
    answer = () => respond(INCIDENT, { modified: new Date(NOW - 25_000).toUTCString() });
    render(<Board />);
    await advance(0);
    expect(headerLink()).toHaveAttribute('data-state', 'crit');

    // The next poll: the server's status is past its TTL.
    answer = expired;
    await advance(INTERVAL);
    // 30 s since the answer, 55 s since the build: both say 55.
    expect(headerLink()).toHaveAccessibleName(/^No signal: last known 55 s ago: Critical/);
    expect(panelHeading()).toHaveTextContent(/^No signal · last known 55 s ago: Critical/);

    // It counts on from there, on the one clock (a few ticks: a long run of
    // them is slow on a loaded machine).
    await advance(5_000);
    expect(headerLink()).toHaveAccessibleName(/^No signal: last known 1 min ago: Critical/);
    expect(panelHeading()).toHaveTextContent(/^No signal · last known 1 min ago: Critical/);
  });

  it('with no build time (an older server), counts from the last answer', async () => {
    answer = () => respond(INCIDENT);
    render(<Board />);
    await advance(0);
    answer = expired;
    await advance(INTERVAL);
    expect(headerLink()).toHaveAccessibleName(/^No signal: last known 30 s ago: Critical/);
    expect(panelHeading()).toHaveTextContent(/^No signal · last known 30 s ago: Critical/);
  });
});
