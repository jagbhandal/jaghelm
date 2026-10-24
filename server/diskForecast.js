/**
 * Disk "days until full" (#670): what GET /api/disk-forecast serves.
 *
 * Prometheus already holds a week of every node's filesystems, so JagHelm
 * keeps nothing: two `query_range` reads (used bytes and size, a point an
 * hour for 7 days, every visible node at once) become one straight line per
 * node and mount, by least squares, and the line says when it reaches the
 * size. Cheap by construction: one answer is kept for CACHE_TTL_MS and shared
 * by every reader, so any number of open tabs cost two queries per window.
 *
 * Which mounts: real filesystems only. tmpfs, overlay, squashfs and the other
 * pseudo types are left out in the query, and so are the mounts under
 * /var/lib/docker (vfs and overlay2 copies of other mounts, which move with
 * every container), /run, /sys, /proc, /dev, /snap, /boot/efi and the bind
 * mounts of /etc/hosts and friends. A node is summed up by its mount with the
 * fewest days left; with no mount filling, by the one its disk meter shows
 * (`/`, or the largest filesystem: `primary`).
 *
 * A line is only believed when the data supports it (`forecastSeries`):
 *  - at least MIN_SAMPLES hours of readings after the last cleanup (a drop of
 *    more than CLEANUP_DROP of the size between two points starts the fit
 *    again after it, so a pruned Docker cache is not a shrinking disk);
 *  - the last reading is current (a node that was shut down, as MS-S1 is when
 *    idle, is `nodata`, never a forecast);
 *  - R² of at least MIN_R2, so a sawtooth of fill and cleanup is `noisy`, not
 *    a date.
 * Flat or shrinking, or further than MAX_DAYS away, is `stable`.
 *
 * Nothing here alerts: the numbers are drawn on the Infrastructure page and
 * the phone's node cards, and the client colours them by the Settings lines.
 */
import { getCached } from './cache.js';
import { getConfig } from './config.js';
import { promQueryRange } from './discovery.js';
import { failureDetail, failureSentence } from './failureWords.js';
import { resolveEntity } from './promHistory.js';
import { createLogger } from './util/logger.js';

const log = createLogger('disk-forecast');

export const WINDOW_DAYS = 7;
export const STEP_SECONDS = 3_600;
/** An answer is kept this long; every reader in that time shares it. */
export const CACHE_TTL_MS = 10 * 60_000;
/** A failed read is kept this long before Prometheus is asked again. */
export const FAILURE_TTL_MS = 30_000;
/** Hours of readings (after the last cleanup) a line needs. */
export const MIN_SAMPLES = 36;
/** R² a line needs to be believed. */
export const MIN_R2 = 0.6;
/** Further away than this is `stable`, not a date. */
export const MAX_DAYS = 365;
/** A drop of this share of the size between two points is a cleanup. */
export const CLEANUP_DROP = 0.02;
/** The last reading may be this many steps older than the end of the window. */
export const STALE_STEPS = 2;

const DAY = 86_400;

// Pseudo filesystems and the mounts that are copies of other mounts.
const FS_EXCLUDE =
  'tmpfs|overlay|squashfs|devtmpfs|ramfs|nfs4?|cifs|smb3|fuse\\\\..*|9p|nsfs|proc|sysfs|cgroup2?|autofs|efivarfs|iso9660';
const MOUNT_EXCLUDE =
  '.*/var/lib/(docker|containers|kubelet)(/.*)?|/(run|sys|proc|dev|snap|boot/efi)(/.*)?|/etc/(hosts|hostname|resolv\\\\.conf)';

/** The two queries for a node matcher: used bytes and size, one series per node and mount. */
export function forecastQueries(matcher) {
  const sel = `${matcher},fstype!="",fstype!~"${FS_EXCLUDE}",mountpoint!~"${MOUNT_EXCLUDE}"`;
  const size = `node_filesystem_size_bytes{${sel}}`;
  // avail, not free: the blocks reserved for root are not space a user can fill.
  const free = `node_filesystem_avail_bytes{${sel}}`;
  return {
    used: `max by (node, mountpoint) (${size} - ${free})`,
    size: `max by (node, mountpoint) (${size})`,
  };
}

/**
 * One line through `points` (`[[seconds, usedBytes], …]`, oldest first):
 * `{ status, daysLeft, growthBytesPerDay, r2, samples }`. `status` is `ok`
 * (`daysLeft` a number, one decimal), `stable`, `noisy`, `insufficient` or
 * `nodata`. Pure.
 *
 * @param {Array<[number, number]>} points
 * @param {number} size  the filesystem's size in bytes
 * @param {number} end   the window's end, seconds
 */
export function forecastSeries(points, size, end) {
  const result = (status, extra = {}) => ({
    status,
    daysLeft: null,
    growthBytesPerDay: null,
    r2: null,
    samples: 0,
    ...extra,
  });
  const clean = points.filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
  if (clean.length === 0 || !(size > 0)) return result('nodata');
  if (end - clean[clean.length - 1][0] > STALE_STEPS * STEP_SECONDS) return result('nodata');

  // Fit only what came after the last cleanup.
  let from = 0;
  for (let i = 1; i < clean.length; i++) {
    if (clean[i - 1][1] - clean[i][1] > CLEANUP_DROP * size) from = i;
  }
  const fit = clean.slice(from);
  if (fit.length < MIN_SAMPLES) return result('insufficient', { samples: fit.length });

  const t0 = fit[0][0];
  const xs = fit.map(([t]) => (t - t0) / DAY);
  const ys = fit.map(([, v]) => v);
  const n = fit.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return result('insufficient', { samples: n });
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const base = { samples: n, r2: Math.round(r2 * 1000) / 1000 };

  if (slope <= 0) return result('stable', { ...base, growthBytesPerDay: Math.round(slope) });
  const last = ys[n - 1];
  const remaining = Math.max(size - last, 0);
  const days = remaining / slope;
  const growthBytesPerDay = Math.round(slope);
  if (days > MAX_DAYS) return result('stable', { ...base, growthBytesPerDay });
  if (r2 < MIN_R2) return result('noisy', { ...base, growthBytesPerDay });
  return result('ok', {
    ...base,
    growthBytesPerDay,
    daysLeft: Math.round(days * 10) / 10,
  });
}

/** Seconds of a Prometheus pair as numbers, null when it isn't a reading. */
const pairOf = ([t, v]) => {
  const n = Number(v);
  return [Number(t), n];
};

/** Of a node's mounts, the one to summarise it: fewest days left, else the primary. */
function summary(mounts) {
  const filling = mounts.filter((m) => m.status === 'ok').sort((a, b) => a.daysLeft - b.daysLeft);
  if (filling.length) return filling[0];
  return mounts.find((m) => m.primary) ?? mounts[0];
}

/**
 * The node forecasts for two matrices (used, size) and the target
 * (`resolveEntity`'s lineOf): `{ [nodeKey]: { mount, primary, status,
 * daysLeft, growthBytesPerDay, r2, samples } }`.
 */
export function forecastsOf({
  usedMatrix,
  sizeMatrix,
  lineOf,
  end,
  keys = [],
  unreachable = () => false,
}) {
  const sizes = new Map();
  for (const r of sizeMatrix ?? []) {
    const values = Array.isArray(r?.values) ? r.values : [];
    const last = values.length ? Number(values[values.length - 1][1]) : NaN;
    if (Number.isFinite(last)) sizes.set(`${r.metric?.node}\u0000${r.metric?.mountpoint}`, last);
  }
  const byNode = new Map();
  for (const r of usedMatrix ?? []) {
    const mount = r?.metric?.mountpoint;
    const size = sizes.get(`${r?.metric?.node}\u0000${mount}`);
    if (typeof mount !== 'string' || size == null) continue;
    const points = (Array.isArray(r.values) ? r.values : []).map(pairOf);
    const f = { mount, size, ...forecastSeries(points, size, end) };
    for (const key of lineOf(r.metric)) byNode.set(key, [...(byNode.get(key) ?? []), f]);
  }
  const out = {};
  for (const [key, mounts] of byNode) {
    // The mount the disk meter shows: `/`, else the largest.
    // A mount with no current readings can't be the one the meter shows.
    const live = mounts.filter((m) => m.status !== 'nodata');
    const pool = live.length ? live : mounts;
    const primaryMount =
      pool.find((m) => m.mount === '/') ?? pool.reduce((a, b) => (b.size > a.size ? b : a));
    const marked = mounts.map((m) => ({ ...m, primary: m === primaryMount }));
    const { size: _size, ...chosen } = summary(marked);
    out[key] = chosen;
  }
  // A node that should have disks but has no series in the window (shut down
  // for over a week, or never scraped) is no signal, not an absence.
  for (const key of keys) {
    if (!out[key] && unreachable(key)) {
      out[key] = {
        mount: null,
        primary: true,
        status: 'nodata',
        daysLeft: null,
        growthBytesPerDay: null,
        r2: null,
        samples: 0,
      };
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * The cache. `queryRange` asks Prometheus (promQueryRange's signature), `now`
 * is the clock in ms, `logger` where a failure's detail goes.
 */
export function createDiskForecastCache({
  queryRange = promQueryRange,
  now = Date.now,
  logger = log,
} = {}) {
  let entry = null; // { key, at, failed, data }
  let asking = null; // { key, promise }
  let failing = null;
  let lastGood = null; // { key, data }: what a failed read keeps serving

  async function compute(target, key) {
    const at = now();
    const end = Math.floor(at / 1000 / 300) * 300;
    const range = { start: end - WINDOW_DAYS * DAY, end, step: STEP_SECONDS };
    const q = forecastQueries(target.matcher);
    try {
      const [usedMatrix, sizeMatrix] = await Promise.all([
        queryRange(q.used, range),
        queryRange(q.size, range),
      ]);
      if (failing !== null) {
        logger.info({ source: 'prometheus' }, 'disk forecast queries answer again');
        failing = null;
      }
      const data = {
        ok: true,
        computedAt: new Date(at).toISOString(),
        windowDays: WINDOW_DAYS,
        nodes: forecastsOf({
          usedMatrix,
          sizeMatrix,
          lineOf: target.lineOf,
          end,
          keys: target.keys,
          unreachable: (k) => getCached('services')?.nodes?.[k]?.reachable !== true,
        }),
      };
      lastGood = { key, data };
      entry = { key, at, failed: false, data };
      return data;
    } catch (err) {
      const error = failureSentence('prometheus', err);
      if (error !== failing) {
        failing = error;
        logger.warn(
          { source: 'prometheus', err: failureDetail(err) },
          'disk forecast query failed; the forecast says so until Prometheus answers'
        );
      }
      // The last good answer keeps being served: a week's line doesn't stop
      // being true because Prometheus missed a read.
      const data = lastGood?.key === key ? lastGood.data : { ok: false, error, nodes: {} };
      entry = { key, at, failed: true, data };
      return data;
    }
  }

  return {
    /** The forecast for every visible node: `{ status, body }`. */
    async answer(config = getConfig()) {
      const target = resolveEntity({ kind: 'node', entity: null }, config);
      if (!target.matcher) {
        return {
          status: 200,
          body: { ok: true, computedAt: null, windowDays: WINDOW_DAYS, nodes: {} },
        };
      }
      const key = target.matcher;
      const ttl = entry?.failed ? FAILURE_TTL_MS : CACHE_TTL_MS;
      if (entry && entry.key === key && now() - entry.at < ttl) {
        return { status: 200, body: entry.data };
      }
      if (!asking || asking.key !== key) {
        const promise = compute(target, key).finally(() => {
          if (asking?.promise === promise) asking = null;
        });
        asking = { key, promise };
      }
      return { status: 200, body: await asking.promise };
    },
    /** Test seam: forget the answer. */
    clear() {
      entry = null;
      asking = null;
      failing = null;
      lastGood = null;
    },
  };
}

/** The server's one cache, which the route reads through. */
export const diskForecastCache = createDiskForecastCache();
