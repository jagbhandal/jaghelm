/*
 * The config drift row (#674): how the hosts' reports are judged (green only for
 * fresh all-ok; stale or never is never green; drift and a failed check amber;
 * an old report from one host is not an alert while another reported lately),
 * that the stale hours setting changes the verdict, what the row draws and opens,
 * that nothing shows without the feature, and that the poll is its own.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import { DRIFT_POLL_MS, ageText, driftView } from './drift.js';
import ConfigDrift from './ConfigDrift.jsx';
import { ConfigDriftSlot } from './ConfigDriftSlot.jsx';

const mocks = vi.hoisted(() => ({ getDrift: vi.fn() }));
vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getDrift: mocks.getDrift,
}));

const NOW = Date.parse('2026-10-24T12:00:00Z');
const H = 3_600_000;
const ago = (ms) => new Date(NOW - ms).toISOString();
const rep = (host, status, age, items = []) => ({
  host,
  status,
  items,
  checkedAt: ago(age),
  receivedAt: ago(age),
});
const body = (...reports) => ({ configured: true, now: new Date(NOW).toISOString(), reports });
const state = (b, config = {}) => driftView(b, config, NOW)?.state;

describe('what the reports are judged as', () => {
  it('nothing without the feature or before an answer', () => {
    expect(driftView(null, {}, NOW)).toBeNull();
    expect(driftView({ configured: false }, {}, NOW)).toBeNull();
    expect(driftView({}, {}, NOW)).toBeNull();
  });

  it('no report ever pushed is grey "No reports", never green', () => {
    const v = driftView(body(), {}, NOW);
    expect(v).toMatchObject({ state: 'none', label: 'No reports' });
  });

  it('green only when every reporting host says ok and the newest report is fresh', () => {
    expect(state(body(rep('pi-1', 'ok', 2 * H), rep('pi-2', 'ok', 5 * H)))).toBe('ok');
  });

  it('amber for drift, and for a check that failed; drift wins', () => {
    expect(state(body(rep('pi-1', 'ok', H), rep('pi-2', 'drift', H)))).toBe('drift');
    expect(state(body(rep('pi-1', 'ok', H), rep('pi-2', 'error', H)))).toBe('error');
    expect(state(body(rep('pi-1', 'error', H), rep('pi-2', 'drift', H)))).toBe('drift');
  });

  it('stale is "unknown", never green: the newest report is older than 36 h', () => {
    const v = driftView(body(rep('pi-1', 'ok', 40 * H), rep('pi-2', 'ok', 50 * H)), {}, NOW);
    expect(v.state).toBe('unknown');
    expect(v.detail).toMatch(/Last report 2 days ago|Last report 40 h ago/);
    expect(state(body(rep('pi-1', 'ok', 36 * H - 1000)))).toBe('ok');
    expect(state(body(rep('pi-1', 'ok', 36 * H + 1000)))).toBe('unknown');
  });

  it('a host that is off (old report) is not an alert while another reported lately, and its age shows', () => {
    const v = driftView(body(rep('ms-s1', 'ok', 5 * 24 * H), rep('pi-1', 'ok', H)), {}, NOW);
    expect(v.state).toBe('ok');
    const off = v.hosts.find((h) => h.host === 'ms-s1');
    expect(off.old).toBe(true);
    expect(off.ageText).toBe('5 days ago');
  });

  it('the stale hours setting changes the verdict; a bad value reads as 36', () => {
    const b = body(rep('pi-1', 'ok', 30 * H));
    expect(state(b, { driftStaleHours: 24 })).toBe('unknown');
    expect(state(b, { driftStaleHours: 48 })).toBe('ok');
    expect(state(b, {})).toBe('ok');
    for (const bad of ['x', 0, 9999, 2.5, null]) expect(state(b, { driftStaleHours: bad })).toBe('ok');
    expect(state(body(rep('pi-1', 'ok', 40 * H)), { driftStaleHours: 'x' })).toBe('unknown');
  });

  it('junk in the answer never throws and is not green', () => {
    const v = driftView({ configured: true, reports: [null, 'x', { host: 'a', status: '?', receivedAt: 'no' }] }, {}, NOW);
    expect(v.state).toBe('error');
    expect(v.hosts).toHaveLength(1);
  });

  it('ages are said in minutes, hours and days', () => {
    expect(ageText(10_000)).toBe('just now');
    expect(ageText(10 * 60_000)).toBe('10 min ago');
    expect(ageText(5 * H)).toBe('5 h ago');
    expect(ageText(72 * H)).toBe('3 days ago');
  });
});

const wrap = (config, ui) => (
  <ConfigProvider config={config} setConfig={() => {}}>
    {ui}
  </ConfigProvider>
);

describe('the row', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    mocks.getDrift.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const mount = async (ui, config = {}) => {
    const out = render(wrap(config, ui));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return out;
  };

  it('draws nothing when the server cannot take reports', async () => {
    mocks.getDrift.mockResolvedValue({ configured: false });
    const { container } = await mount(<ConfigDrift />);
    expect(container).toBeEmptyDOMElement();
  });

  it('grey "No reports" with nothing to open', async () => {
    mocks.getDrift.mockResolvedValue(body());
    await mount(<ConfigDrift />);
    const region = screen.getByRole('region', { name: 'Config drift' });
    expect(within(region).getByText('No reports')).toHaveAttribute('data-state', 'none');
    expect(within(region).queryByRole('button')).toBeNull();
  });

  it('opens the per-host list with the drift items and each report\'s age', async () => {
    mocks.getDrift.mockResolvedValue(
      body(
        rep('pi-1', 'drift', 2 * H, [{ name: '/etc/keepalived/keepalived.conf', kind: 'DIFF', detail: '' }]),
        rep('ms-s1', 'ok', 4 * 24 * H)
      )
    );
    await mount(<ConfigDrift />);
    const region = screen.getByRole('region', { name: 'Config drift' });
    expect(within(region).getByText('Drift')).toHaveAttribute('data-state', 'drift');
    expect(within(region).getByText('Drift on pi-1')).toBeInTheDocument();
    expect(screen.queryByText('/etc/keepalived/keepalived.conf')).toBeNull();
    fireEvent.click(within(region).getByRole('button'));
    expect(within(region).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('/etc/keepalived/keepalived.conf')).toBeInTheDocument();
    expect(screen.getByText('Reported 2 h ago')).toBeInTheDocument();
    expect(screen.getByText('Last reported 4 days ago')).toBeInTheDocument();
  });

  it('a silent row reads Unknown (amber), and changing the setting changes it on the next render', async () => {
    mocks.getDrift.mockResolvedValue(body(rep('pi-1', 'ok', 30 * H)));
    const { rerender } = await mount(<ConfigDrift />, { driftStaleHours: 24 });
    expect(screen.getByText('Unknown')).toHaveAttribute('data-state', 'unknown');
    rerender(wrap({ driftStaleHours: 48 }, <ConfigDrift />));
    expect(screen.getByText('No drift')).toHaveAttribute('data-state', 'ok');
  });

  it('reads on mount and every 5 minutes, keeps the last answer through a failed read', async () => {
    mocks.getDrift.mockResolvedValue(body(rep('pi-1', 'ok', H)));
    await mount(<ConfigDrift />);
    expect(mocks.getDrift).toHaveBeenCalledTimes(1);
    mocks.getDrift.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_POLL_MS);
    });
    expect(mocks.getDrift).toHaveBeenCalledTimes(2);
    expect(screen.getByText('No drift')).toBeInTheDocument();
  });

  it('the slot loads the chunk once idle and draws it; unmounted, nothing is asked', async () => {
    mocks.getDrift.mockResolvedValue(body(rep('pi-1', 'ok', H)));
    const { unmount } = render(wrap({}, <ConfigDriftSlot phone />));
    expect(mocks.getDrift).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText('No drift')).toBeInTheDocument();
    unmount();
    mocks.getDrift.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * DRIFT_POLL_MS);
    });
    expect(mocks.getDrift).not.toHaveBeenCalled();
  });
});
