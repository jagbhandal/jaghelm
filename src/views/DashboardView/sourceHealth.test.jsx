import { describe, it, expect } from 'vitest';
import { SOURCE_MESSAGES, formatAgo, sourceBanner } from './sourceHealth';

describe('sourceHealth — formatAgo', () => {
  it('formats sub-minute, minute, hour, and day ages', () => {
    expect(formatAgo(5_000)).toBe('5s ago');
    expect(formatAgo(90_000)).toBe('1m ago');
    expect(formatAgo(2 * 3_600_000)).toBe('2h ago');
    expect(formatAgo(3 * 86_400_000)).toBe('3d ago');
  });

  it('returns empty string for nullish / invalid input', () => {
    expect(formatAgo(null)).toBe('');
    expect(formatAgo(undefined)).toBe('');
    expect(formatAgo(-1)).toBe('');
    expect(formatAgo(NaN)).toBe('');
  });
});

describe('sourceHealth — sourceBanner', () => {
  const INTERVAL = 30_000; // 30s
  const NOW = 1_000_000_000_000;

  it('names the Prometheus cause for a services error', () => {
    const { message } = sourceBanner(
      { error: 'HTTP 502', lastSuccessMs: NOW },
      'services',
      INTERVAL,
      NOW
    );
    expect(message).toBe(SOURCE_MESSAGES.services);
    expect(message).toMatch(/Prometheus/);
  });

  it('uses each source key’s own distinct message', () => {
    const err = { error: 'boom', lastSuccessMs: NOW };
    expect(sourceBanner(err, 'ups', INTERVAL, NOW).message).toMatch(/NUT/);
    expect(sourceBanner(err, 'commits', INTERVAL, NOW).message).toMatch(/Gitea/);
    expect(sourceBanner(err, 'cron', INTERVAL, NOW).message).toMatch(/cron/i);
    expect(sourceBanner(err, 'integrations', INTERVAL, NOW).message).toMatch(/integrations/i);
  });

  it('keeps the Uptime Kuma wording distinct from the Prometheus one', () => {
    expect(SOURCE_MESSAGES.monitors).toMatch(/Uptime Kuma/);
    expect(SOURCE_MESSAGES.monitors).not.toBe(SOURCE_MESSAGES.services);
  });

  it('falls back to the raw error when the key has no canned message', () => {
    const { message } = sourceBanner(
      { error: 'weird', lastSuccessMs: NOW },
      'unknownKey',
      INTERVAL,
      NOW
    );
    expect(message).toBe('weird');
  });

  it('emits no message when the source is healthy', () => {
    expect(
      sourceBanner({ error: null, lastSuccessMs: NOW }, 'services', INTERVAL, NOW).message
    ).toBeNull();
  });

  it('flags staleness only past ~2 refresh intervals', () => {
    // Fresh — last success 1 interval ago → not stale.
    const fresh = sourceBanner(
      { error: null, lastSuccessMs: NOW - INTERVAL },
      'services',
      INTERVAL,
      NOW
    );
    expect(fresh.staleNote).toBeNull();

    // Stale — last success 3 intervals ago → stale, with an "updated … ago" note.
    const stale = sourceBanner(
      { error: null, lastSuccessMs: NOW - 3 * INTERVAL },
      'services',
      INTERVAL,
      NOW
    );
    expect(stale.staleNote).toMatch(/^updated .+ ago$/);
  });

  it('reports staleness and error independently (both can be set)', () => {
    const both = sourceBanner(
      { error: 'HTTP 502', lastSuccessMs: NOW - 5 * INTERVAL },
      'services',
      INTERVAL,
      NOW
    );
    expect(both.message).toMatch(/Prometheus/);
    expect(both.staleNote).toMatch(/updated/);
  });

  it('does not count time spent paused as silence, but reports the real age', () => {
    // Last success 10 intervals ago, polling resumed 1 interval ago → not stale yet.
    const resumed = {
      error: null,
      lastSuccessMs: NOW - 10 * INTERVAL,
      watchedSinceMs: NOW - INTERVAL,
    };
    expect(sourceBanner(resumed, 'services', INTERVAL, NOW).staleNote).toBeNull();

    // Still no success 3 intervals after resuming → stale, with the true age.
    const still = { ...resumed, watchedSinceMs: NOW - 3 * INTERVAL };
    expect(sourceBanner(still, 'services', INTERVAL, NOW).staleNote).toBe('updated 5m ago');
  });

  it('keeps the age note of a source still failing after a return', () => {
    // Failing for 2 hours; polling resumed 1 interval ago. The pause doesn't
    // reset its silence: it still fails, so the note keeps the real age.
    const failing = {
      error: 'HTTP 502',
      lastSuccessMs: NOW - 2 * 3_600_000,
      watchedSinceMs: NOW - INTERVAL,
    };
    const out = sourceBanner(failing, 'cron', INTERVAL, NOW);
    expect(out.message).toMatch(/cron/i);
    expect(out.staleNote).toBe('updated 2h ago');
  });

  it('never reports staleness when there has been no success yet', () => {
    const out = sourceBanner({ error: 'HTTP 502', lastSuccessMs: null }, 'services', INTERVAL, NOW);
    expect(out.staleNote).toBeNull();
  });

  it('returns an inert result for a missing source', () => {
    expect(sourceBanner(undefined, 'services', INTERVAL, NOW)).toEqual({
      message: null,
      staleNote: null,
    });
  });
});
