import { describe, it, expect } from 'vitest';
import { HEALTHY, SOURCE_MESSAGES, formatAgo, sourceBanner } from './sourceHealth.js';

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
  // What useDashboardData says of a source: its error, and its note once its
  // last answer is stale (judged there, by the header's rule, #559).
  const source = (overrides = {}) => ({ error: null, staleNote: null, ...overrides });

  it('names the Prometheus cause for a services error', () => {
    const { message } = sourceBanner(source({ error: 'HTTP 502' }), 'services');
    expect(message).toBe(SOURCE_MESSAGES.services);
    expect(message).toMatch(/Prometheus/);
  });

  it('uses each source key’s own distinct message: the two the Overview reads (#306)', () => {
    const err = source({ error: 'boom' });
    expect(Object.keys(SOURCE_MESSAGES)).toEqual(['services', 'integrations']);
    expect(sourceBanner(err, 'integrations').message).toMatch(/integrations/i);
    expect(SOURCE_MESSAGES.integrations).not.toBe(SOURCE_MESSAGES.services);
  });

  it('falls back to the raw error when the key has no canned message', () => {
    expect(sourceBanner(source({ error: 'weird' }), 'unknownKey').message).toBe('weird');
  });

  it('a healthy source: HEALTHY, the same frozen object every time (#252)', () => {
    expect(sourceBanner(source(), 'services')).toBe(HEALTHY);
    expect(sourceBanner(source(), 'integrations')).toBe(HEALTHY);
    expect(Object.isFrozen(HEALTHY)).toBe(true);
  });

  it('carries the note the hook gave a stale source, with no message', () => {
    expect(sourceBanner(source({ staleNote: 'updated 5m ago' }), 'services')).toEqual({
      message: null,
      staleNote: 'updated 5m ago',
    });
  });

  it('reports staleness and error independently (both can be set)', () => {
    const both = sourceBanner(
      source({ error: 'HTTP 502', staleNote: 'updated 2h ago' }),
      'integrations'
    );
    expect(both.message).toMatch(/integrations/i);
    expect(both.staleNote).toBe('updated 2h ago');
  });

  it('returns an inert result for a missing source', () => {
    expect(sourceBanner(undefined, 'services')).toEqual({
      message: null,
      staleNote: null,
    });
  });
});
