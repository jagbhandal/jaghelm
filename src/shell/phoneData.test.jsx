import { afterEach, describe, expect, it, vi } from 'vitest';
import { openTarget, phoneData } from './phoneData.js';

// What the web gives the phone screens (#303): their `data`, as the Android
// app's useDashboard shapes it, from the web's poll and the board's reads.

const STATUS = { overall: { state: 'ok', sentence: 'All 3 services up' } };
const FRESH = Object.freeze({ stale: false });
const CARDS = { nodes: { apps: { display_name: 'App Server', services: [] } } };
const board = (over = {}) => ({
  serviceData: { nodes: {} },
  ups: null,
  servicesLoaded: false,
  sources: { services: { error: null } },
  ...over,
});
const data = (over) =>
  phoneData({ status: STATUS, reach: 'ok', updated: null, freshness: FRESH, board: board(over) });

describe('phoneData', () => {
  it('is loading, with no cards, until /api/services has answered once', () => {
    expect(data()).toMatchObject({ loading: true, servicesBody: null, error: null });
    expect(data().status).toBe(STATUS);
    expect(data().freshness).toBe(FRESH);
  });

  it('then has the cards it read, and the UPS', () => {
    const ups = { status: 1, charge: 100 };
    expect(data({ servicesLoaded: true, serviceData: CARDS, ups })).toMatchObject({
      loading: false,
      servicesBody: CARDS,
      ups,
      error: null,
    });
  });

  it('a failed read is the error, over the last cards it had, or with none', () => {
    const failed = { services: { error: 'HTTP 502' } };
    expect(data({ servicesLoaded: true, sources: failed })).toMatchObject({
      servicesBody: null,
      error: 'HTTP 502',
    });
    expect(data({ servicesLoaded: true, serviceData: CARDS, sources: failed }).servicesBody).toBe(
      CARDS
    );
  });
});

describe('openTarget: the web’s link rule (Settings → Layout)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens an http or https address in a new tab, without the opener', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openTarget({ kind: 'service', uid: 'a:b', url: 'https://grafana.example/' });
    expect(open).toHaveBeenCalledWith('https://grafana.example/', '_blank', 'noopener,noreferrer');
  });

  it('in this tab when Settings says so', () => {
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
    openTarget({ url: 'https://grafana.example/' }, '_self');
    expect(assign).toHaveBeenCalledWith('https://grafana.example/');
  });

  it('never an address that isn’t http, https or mailto', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    openTarget({ url: 'javascript:alert(1)' });
    openTarget({ url: '' });
    expect(open).not.toHaveBeenCalled();
  });
});
