/*
 * The Backups section (#675): how a server answer is judged and drawn. Never
 * seen is unknown (not green), a failed last run is red, age is judged against
 * the lines Settings keeps (and an off host is amber at most), the B2 row says
 * a rejected key, hidden-version bloat and a stale sample, and the poll is the
 * component's own.
 */
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigProvider } from '../context/ConfigContext.jsx';
import {
  BACKUPS_POLL_MS,
  ageState,
  b2View,
  backupsView,
  bytesText,
  jobRow,
} from './backups.js';
import Backups from './Backups.jsx';
import { BackupsSlot } from './BackupsSlot.jsx';

const mocks = vi.hoisted(() => ({ getBackups: vi.fn() }));
vi.mock('../hooks/useData.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getBackups: mocks.getBackups,
}));

const NOW = Date.parse('2026-10-24T12:00:00Z');
const H = 3_600_000;
const LINES = { warn: 36, crit: 72 };
const job = (over = {}) => ({
  key: 'pve:proxmox-backup',
  node: 'pve',
  job: 'proxmox-backup',
  seen: true,
  hostDown: false,
  last: { at: NOW - 7 * H, status: 'success' },
  lastGood: NOW - 7 * H,
  failedRuns: 0,
  runs: 3,
  ...over,
});
const GB = 1e9;
const b2 = (over = {}) => ({
  configured: true,
  bucket: 'jagnet-homelab-backup',
  pending: false,
  error: null,
  checkedAt: NOW - 3 * H,
  liveBytes: 210 * GB,
  hiddenBytes: 2 * GB,
  hiddenVersions: 4,
  files: 100,
  weekChangeBytes: 4.2 * GB,
  history: [
    [NOW - 8 * 86_400_000, 205 * GB],
    [NOW - 3 * H, 210 * GB],
  ],
  prefixes: [{ name: 'FamilyVault', bytes: 5 * GB, files: 2, lastUpload: NOW - 5 * H }],
  ...over,
});

describe('bytesText', () => {
  it('decimal units, as Backblaze bills', () => {
    expect([0, 999, 1500, 2.5e6, 3.4e9, 210e9, 1.5e12].map(bytesText)).toEqual([
      '0 B',
      '999 B',
      '2 kB',
      '3 MB',
      '3.4 GB',
      '210 GB',
      '1.5 TB',
    ]);
    expect(bytesText(undefined)).toBe('0 B');
  });
});

describe('a job’s row', () => {
  it('never reported is unknown, with no age and not green', () => {
    const r = jobRow(job({ seen: false, last: null, lastGood: null, runs: 0 }), LINES, NOW);
    expect(r).toMatchObject({ state: 'unknown', word: 'Unknown' });
    expect(r.detail).toMatch(/Nothing has reported/);
  });

  it('a recent good run is green and muted', () => {
    expect(jobRow(job(), LINES, NOW)).toMatchObject({
      state: 'ok',
      word: 'OK',
      detail: 'Last good run 7 h ago',
      muted: true,
    });
  });

  it('is amber from the first line and red from the second', () => {
    const at = (h) => jobRow(job({ lastGood: NOW - h * H, last: { at: NOW - h * H, status: 'success' } }), LINES, NOW);
    expect([35, 36, 71, 72].map((h) => at(h).state)).toEqual(['ok', 'warn', 'warn', 'crit']);
    expect(at(40).word).toBe('Late');
    expect(at(80).word).toBe('Stale');
  });

  it('moving the lines moves the colours', () => {
    const old = job({ lastGood: NOW - 10 * H, last: { at: NOW - 10 * H, status: 'success' } });
    expect(jobRow(old, LINES, NOW).state).toBe('ok');
    expect(jobRow(old, { warn: 6, crit: 9 }, NOW).state).toBe('crit');
  });

  it('a stale report is amber only when the board knows the node and says it is unreachable', () => {
    const stale = (over) => job({ lastGood: NOW - 120 * H, last: { at: NOW - 120 * H, status: 'success' }, ...over });
    // docker-brain, 5 days stale, host not known down: red, with no claim about the host.
    const brain = jobRow(stale({ key: 'docker-brain:vm103-backup', node: 'docker-brain', job: 'vm103-backup' }), LINES, NOW);
    expect(brain.state).toBe('crit');
    expect(brain.detail).not.toMatch(/not reporting|reachable/);
    // nas known unreachable: amber, saying so.
    const nas = jobRow(stale({ node: 'nas', job: 'nas-b2-backup', hostDown: true }), LINES, NOW);
    expect(nas.state).toBe('warn');
    expect(nas.detail).toMatch(/nas is not reporting/);
    // pve stale and up: red.
    expect(jobRow(stale({}), LINES, NOW).state).toBe('crit');
  });

  it('a failed last run is red whatever the age or host, with its words and the last good run', () => {
    const r = jobRow(
      job({ hostDown: true, last: { at: NOW - 2 * H, status: 'failure', error: 'FamilyVault: sentinel missing' }, lastGood: NOW - 26 * H }),
      LINES,
      NOW
    );
    expect(r).toMatchObject({ state: 'crit', word: 'Failed', meta: 'last good 1 d ago' });
    expect(r.detail).toBe('Failed 2 h ago: FamilyVault: sentinel missing');
    const none = jobRow(job({ last: { at: NOW - 2 * H, status: 'failure' }, lastGood: null, runs: 3 }), LINES, NOW);
    expect(none.meta).toBe('no good run in the last 3');
  });

  it('ageState on the lines', () => {
    expect([0, 35.9, 36, 72].map((h) => ageState(h, LINES))).toEqual(['ok', 'ok', 'warn', 'crit']);
  });
});

describe('the B2 row', () => {
  it('not set up is nothing', () => {
    expect(b2View(undefined, NOW)).toBeNull();
    expect(b2View({ configured: false }, NOW)).toBeNull();
  });

  it('before the first check it is unknown, or says the key was rejected', () => {
    expect(b2View({ configured: true, bucket: 'b', pending: true, error: null }, NOW)).toMatchObject({
      state: 'unknown',
      detail: 'Waiting for the first daily check',
    });
    const r = b2View({ configured: true, bucket: 'b', pending: false, error: 'key-rejected' }, NOW);
    expect(r).toMatchObject({ state: 'warn', word: 'Key rejected' });
    expect(r.detail).toMatch(/B2 key rejected/);
  });

  it('size, the week’s change and a sparkline from a week of history', () => {
    const v = b2View(b2(), NOW);
    expect(v).toMatchObject({ kind: 'size', state: 'ok', size: '210 GB' });
    expect(v.detail).toBe('210 GB · +4.2 GB in 7 d');
    expect(v.history).toHaveLength(2);
    expect(v.hidden).toEqual({ state: 'ok', text: '2.0 GB in older versions' });
    expect(v.folders).toEqual([{ name: 'FamilyVault', size: '5.0 GB', last: '5 h ago' }]);
    expect(b2View(b2({ weekChangeBytes: null }), NOW).detail).toBe('210 GB');
    expect(b2View(b2({ weekChangeBytes: -2 * GB }), NOW).detail).toBe('210 GB · −2.0 GB in 7 d');
  });

  it('hidden versions beyond 10 GB and a tenth of the bucket are amber', () => {
    expect(b2View(b2({ hiddenBytes: 30 * GB }), NOW)).toMatchObject({
      state: 'warn',
      word: 'Hidden versions',
      hidden: { state: 'warn', text: '30 GB hidden versions' },
    });
    // 12 GB on a 500 GB bucket is churn, not bloat; 12 GB on 100 GB is.
    expect(b2View(b2({ hiddenBytes: 12 * GB, liveBytes: 500 * GB }), NOW).state).toBe('ok');
    expect(b2View(b2({ hiddenBytes: 12 * GB, liveBytes: 100 * GB }), NOW).state).toBe('warn');
  });

  it('a sample over two days old, or a failing check, is said', () => {
    const stale = b2View(b2({ checkedAt: NOW - 3 * 86_400_000 }), NOW);
    expect(stale).toMatchObject({ state: 'warn', word: 'Stale' });
    expect(stale.detail).toMatch(/checked 3 d ago/);
    const failing = b2View(b2({ error: 'unreachable' }), NOW);
    expect(failing.detail).toMatch(/last check failed/);
    expect(b2View(b2({ error: 'key-rejected' }), NOW)).toMatchObject({ state: 'warn', word: 'Key rejected' });
  });
});

describe('backupsView', () => {
  it('nothing without an answer, jobs or B2', () => {
    expect(backupsView(null, {}, NOW)).toBeNull();
    expect(backupsView({ jobs: [], b2: { configured: false } }, {}, NOW)).toBeNull();
    expect(backupsView({ jobs: 'x', b2: 5 }, {}, NOW)).toBeNull();
  });

  it('counts and the worst state; the lines come from the config, junk jobs are skipped', () => {
    const body = {
      jobs: [job(), job({ key: 'a:b', node: 'a', job: 'b', seen: false, last: null, lastGood: null }), null],
      b2: { configured: false },
    };
    const v = backupsView(body, {}, NOW);
    expect(v.rows).toHaveLength(2);
    expect(v.state).toBe('unknown');
    expect(v.count).toBe('2 backups · 1 unknown');
    expect(backupsView({ ...body, jobs: [job()] }, {}, NOW).count).toBe('1 backup · all fresh');
    // A saved pair of 5 and 6 hours makes the 7-hour-old run red.
    expect(backupsView({ jobs: [job()] }, { backupAgeHours: { warn: 5, crit: 6 } }, NOW).state).toBe('crit');
    // A saved pair that is no pair is the defaults.
    expect(backupsView({ jobs: [job()] }, { backupAgeHours: { warn: 6, crit: 5 } }, NOW).state).toBe('ok');
  });
});

describe('the section', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    mocks.getBackups.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  const mount = async (ui, config = {}) => {
    const out = render(
      <ConfigProvider config={config} setConfig={() => {}}>
        {ui}
      </ConfigProvider>
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return out;
  };

  it('draws a row per job and the bucket, with the hidden-version warning', async () => {
    mocks.getBackups.mockResolvedValue({
      jobs: [job(), job({ key: 'nas:nas-b2-backup', node: 'nas', job: 'nas-b2-backup', last: { at: NOW - 2 * H, status: 'failure', error: 'over the cap' } })],
      b2: b2({ hiddenBytes: 40 * GB }),
    });
    await mount(<Backups />);
    const section = screen.getByRole('region', { name: 'Backups' });
    expect(within(section).getByText('proxmox-backup')).toBeInTheDocument();
    expect(within(section).getByText(/Failed 2 h ago: over the cap/)).toBeInTheDocument();
    expect(within(section).getByText('B2 bucket')).toBeInTheDocument();
    expect(within(section).getByText('40 GB hidden versions')).toBeInTheDocument();
    expect(within(section).getByText('Last data uploaded, by folder')).toBeInTheDocument();
  });

  it('draws nothing with no job marked and no B2 key', async () => {
    mocks.getBackups.mockResolvedValue({ jobs: [], b2: { configured: false } });
    const { container } = await mount(<Backups />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the saved lines change what it draws', async () => {
    mocks.getBackups.mockResolvedValue({ jobs: [job()], b2: { configured: false } });
    await mount(<Backups />, { backupAgeHours: { warn: 2, crit: 5 } });
    const row = screen.getByText('proxmox-backup').closest('[data-entity]');
    // The state is a lamp named by its word, and the (muted) detail turns to the state's colour.
    expect(within(row).getByRole('img', { name: 'Stale' })).toBeInTheDocument();
  });

  it('reads on mount and every 5 minutes, keeping the last answer through a failed read', async () => {
    mocks.getBackups.mockResolvedValue({ jobs: [job()], b2: { configured: false } });
    await mount(<Backups />);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    mocks.getBackups.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKUPS_POLL_MS);
    });
    expect(mocks.getBackups).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('region', { name: 'Backups' })).toBeInTheDocument();
  });

  it('the slot loads the chunk once idle; unmounted, nothing is asked', async () => {
    mocks.getBackups.mockResolvedValue({ jobs: [job()], b2: { configured: false } });
    const { unmount } = await mount(<BackupsSlot />);
    expect(mocks.getBackups).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText('proxmox-backup')).toBeInTheDocument();
    unmount();
    mocks.getBackups.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * BACKUPS_POLL_MS);
    });
    expect(mocks.getBackups).not.toHaveBeenCalled();
  });
});
