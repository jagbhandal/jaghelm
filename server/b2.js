/**
 * The B2 bucket's size and its trend (#675, part of the Backups section).
 *
 * Read-only, in the background, never during a page request. With
 * JAGHELM_B2_KEY_ID, JAGHELM_B2_APP_KEY (a read-only application key
 * restricted to the bucket) and JAGHELM_B2_BUCKET all set, a job lists the
 * bucket's file versions through Backblaze's native API once a day (and once
 * shortly after boot unless a sample is already fresh), and keeps the result in
 * data/b2-usage.json: the latest sample and at most HISTORY_MAX daily points
 * for the sparkline. GET /api/backups serves what the store holds; with any of
 * the three unset this part is simply absent.
 *
 * The listing is b2_list_file_versions (every version, newest first for a
 * name), so one pass gives both numbers the card needs:
 *  - `liveBytes`: the newest version of each file, when it is an upload (a
 *    file whose newest version is a hide marker is deleted, and counts for
 *    nothing here);
 *  - `hiddenBytes`: every older upload version, which B2 keeps until the
 *    bucket's lifecycle rule purges it. A recurrence of the old "keep all
 *    versions" bloat shows up here.
 * Per top-level folder it also keeps the newest upload time: an honest "last
 * data uploaded" for each part of the bucket.
 *
 * Safety: requests go only to https hosts under backblazeb2.com (the fixed
 * authorize URL, then the apiUrl and downloadUrl it returns, each checked);
 * every request has a timeout, the run a deadline and a page cap; one run at a
 * time; a failing run backs off (longer for a rejected key). The authorization
 * token lives in a variable of one run and nowhere else; the application key
 * and the token are never logged, stored or served, and an error text is made
 * of fixed words (never Backblaze's own message, never a URL).
 */
import { envValue } from './env.js';
import { safeFetch } from './httpClient.js';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { createLogger } from './util/logger.js';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const defaultLog = createLogger('b2');

export const AUTHORIZE_URL = 'https://api.backblazeb2.com/b2api/v3/b2_authorize_account';
export const STORE_PATH = join(DATA_DIR, 'b2-usage.json');

/** One run a day, and the first one this long after boot. */
export const RUN_EVERY_MS = 24 * 60 * 60_000;
/** A Retry-After from Backblaze is honoured up to this. */
export const RETRY_AFTER_MAX_MS = 6 * 60 * 60_000;
export const BOOT_DELAY_MS = 90_000;
/** A sample younger than this at boot is not taken again right away. */
export const FRESH_MS = 6 * 60 * 60_000;
/** Backoff after a failed run: doubling from the first, up to the ceiling. */
export const BACKOFF_MS = Object.freeze({ other: [30 * 60_000, 6 * 60 * 60_000], auth: [6 * 60 * 60_000, RUN_EVERY_MS] });
/** One request, and a whole run. */
export const REQUEST_TIMEOUT_MS = 20_000;
export const RUN_DEADLINE_MS = 3 * 60_000;
/** Files per page (B2 allows 10 000; 5 000 keeps a page well under the body cap), and pages per run. */
export const PAGE_SIZE = 5000;
export const MAX_PAGES = 200;
/** Daily points kept. */
export const HISTORY_MAX = 90;
/** Distinct top-level folders kept (the rest are counted in "other"). */
export const PREFIX_MAX = 40;
const OTHER = '(other)';
const ROOT = '(root)';

/** Whether `value` is an https URL on backblazeb2.com or a subdomain of it, with no credential and no odd port. */
export function isB2Url(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const u = new URL(value);
  return (
    u.protocol === 'https:' &&
    u.username === '' &&
    u.password === '' &&
    (u.port === '' || u.port === '443') &&
    (u.hostname === 'backblazeb2.com' || u.hostname.endsWith('.backblazeb2.com'))
  );
}

/** What went wrong, in fixed words: `kind` is 'auth' (the key was refused) or 'other'. */
export class B2Error extends Error {
  /** @param {'auth' | 'other'} kind @param {string} message @param {number} [retryAfterMs] */
  constructor(kind, message, retryAfterMs) {
    super(message);
    this.name = 'B2Error';
    this.kind = kind;
    if (retryAfterMs) this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The tally over a bucket's file versions, fed in listing order (by name, a
 * name's newest version first).
 */
export function createTally() {
  let currentName = null;
  let liveBytes = 0;
  let hiddenBytes = 0;
  let files = 0;
  let hiddenVersions = 0;
  /** @type {Map<string, { bytes: number, files: number, lastUpload: number }>} */
  const prefixes = new Map();

  const prefixOf = (name) => {
    const slash = name.indexOf('/');
    const key = slash > 0 ? name.slice(0, slash) : ROOT;
    if (prefixes.has(key) || prefixes.size < PREFIX_MAX) return key;
    return OTHER;
  };
  const entry = (key) => {
    let p = prefixes.get(key);
    if (!p) {
      p = { bytes: 0, files: 0, lastUpload: 0 };
      prefixes.set(key, p);
    }
    return p;
  };

  return {
    /** @param {any} f one entry of b2_list_file_versions' `files` */
    add(f) {
      if (!f || typeof f.fileName !== 'string') return;
      // Folders and unfinished large files (`start`) are not versions: they must
      // not make the real newest upload look old.
      if (f.action === 'start' || f.action === 'folder') return;
      const newest = f.fileName !== currentName;
      currentName = f.fileName;
      if (f.action !== 'upload') return; // a hide marker holds no bytes
      const size = Number.isFinite(f.contentLength) && f.contentLength > 0 ? f.contentLength : 0;
      const when = Number.isFinite(f.uploadTimestamp) ? f.uploadTimestamp : 0;
      const p = entry(prefixOf(f.fileName));
      if (when > p.lastUpload) p.lastUpload = when;
      if (newest) {
        liveBytes += size;
        files += 1;
        p.bytes += size;
        p.files += 1;
      } else {
        hiddenBytes += size;
        hiddenVersions += 1;
      }
      // A name whose newest entry is a hide marker has `newest` false for every upload below it: all hidden.
    },
    result() {
      return {
        liveBytes,
        hiddenBytes,
        files,
        hiddenVersions,
        prefixes: [...prefixes.entries()]
          .map(([name, p]) => ({ name, ...p }))
          .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
      };
    },
  };
}

/**
 * The B2 calls of one run. `fetchFn(url, { method, headers, body, timeoutMs })`
 * is safeFetch's shape; a test passes its own.
 *
 * @param {{ keyId: string, appKey: string, bucket: string, fetchFn?: Function, now?: () => number }} cfg
 */
export function createB2Client({ keyId, appKey, bucket, fetchFn = safeFetch, now = Date.now }) {
  const call = async (url, { method = 'GET', headers = {}, body } = {}) => {
    let res;
    try {
      res = await fetchFn(url, { method, headers, body, timeoutMs: REQUEST_TIMEOUT_MS, trusted: false, noRedirects: true });
    } catch {
      // The reason (a DNS name, a socket error) says nothing a reader can act on.
      throw new B2Error('other', 'Backblaze did not answer');
    }
    if (res.status === 401 || res.status === 403) {
      throw new B2Error('auth', 'Backblaze refused the key');
    }
    if (res.status >= 300 && res.status < 400) throw new B2Error('other', 'Backblaze answered with a redirect');
    if ((res.status === 429 || res.status === 503) && typeof res.headers?.get === 'function') {
      const secs = Number(res.headers.get('retry-after'));
      const ms = Number.isFinite(secs) && secs > 0 ? Math.min(secs * 1000, RETRY_AFTER_MAX_MS) : 0;
      throw new B2Error('other', `Backblaze answered HTTP ${res.status}`, ms);
    }
    if (!res.ok) throw new B2Error('other', `Backblaze answered HTTP ${res.status}`);
    try {
      return JSON.parse(await res.text());
    } catch {
      throw new B2Error('other', 'Backblaze answered with something that is not JSON');
    }
  };
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /**
   * One run: authorize, find the bucket, list every version, tally. Returns the
   * tally or throws B2Error. The token is a local of this call.
   */
  async function sample() {
    const started = now();
    const basic = Buffer.from(`${keyId}:${appKey}`).toString('base64');
    const auth = await call(AUTHORIZE_URL, { headers: { Authorization: `Basic ${basic}` } });
    const api = auth?.apiInfo?.storageApi ?? auth;
    const token = auth?.authorizationToken;
    const apiUrl = api?.apiUrl;
    const downloadUrl = api?.downloadUrl;
    if (typeof token !== 'string' || !token || typeof auth?.accountId !== 'string') {
      throw new B2Error('other', 'Backblaze answered with something unexpected');
    }
    // The only hosts a later request may go to: both of the account's own, under backblazeb2.com.
    if (!isB2Url(apiUrl) || !isB2Url(downloadUrl)) {
      throw new B2Error('other', 'Backblaze named an address outside backblazeb2.com');
    }
    const base = apiUrl.replace(/\/+$/, '');
    const post = (path, payload) =>
      call(`${base}/b2api/v3/${path}`, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    // v3 names a restricted key's bucket and prefix under `allowed`; older shapes had them beside it.
    const allowed = isObj(api.allowed) ? api.allowed : isObj(auth.allowed) ? auth.allowed : {};
    const namePrefix = typeof allowed.namePrefix === 'string' && allowed.namePrefix ? allowed.namePrefix : null;
    const fromKey = (Array.isArray(allowed.buckets) ? allowed.buckets : []).find(
      (b) => isObj(b) && (b.name === bucket || b.bucketName === bucket) && typeof (b.id ?? b.bucketId) === 'string'
    );
    let bucketId = fromKey
      ? (fromKey.id ?? fromKey.bucketId)
      : api.bucketName === bucket && typeof api.bucketId === 'string'
        ? api.bucketId
        : null;
    if (!bucketId) {
      const listed = await post('b2_list_buckets', { accountId: auth.accountId, bucketName: bucket });
      const found = (Array.isArray(listed?.buckets) ? listed.buckets : []).find(
        (b) => isObj(b) && b.bucketName === bucket && typeof b.bucketId === 'string'
      );
      if (!found) throw new B2Error('other', 'The key cannot see the bucket named in JAGHELM_B2_BUCKET');
      bucketId = found.bucketId;
    }

    const tally = createTally();
    let startFileName = null;
    let startFileId = null;
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new B2Error('other', `The bucket has more than ${MAX_PAGES} pages of files`);
      if (now() - started > RUN_DEADLINE_MS) throw new B2Error('other', 'Listing the bucket took too long');
      const body = await post('b2_list_file_versions', {
        bucketId,
        maxFileCount: PAGE_SIZE,
        ...(namePrefix && { prefix: namePrefix }),
        ...(startFileName !== null && { startFileName, ...(startFileId && { startFileId }) }),
      });
      if (!Array.isArray(body?.files)) throw new B2Error('other', 'Backblaze answered with something unexpected');
      for (const f of body.files) tally.add(f);
      if (typeof body.nextFileName !== 'string' || !body.nextFileName) break;
      // A page that does not move on would loop for ever.
      if (body.nextFileName === startFileName && (body.nextFileId ?? null) === startFileId) {
        throw new B2Error('other', 'Backblaze answered with the same page twice');
      }
      startFileName = body.nextFileName;
      startFileId = typeof body.nextFileId === 'string' ? body.nextFileId : null;
    }
    return { ...tally.result(), ...(namePrefix && { restrictedTo: namePrefix }) };
  }
  return { sample };
}

const isMs = (v) => Number.isFinite(v) && v >= 0;
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);

/** One saved point, or null when it is none. */
function cleanPoint(p) {
  if (!p || typeof p !== 'object' || !isMs(p.t)) return null;
  return { t: p.t, live: num(p.live), hidden: num(p.hidden), files: Math.floor(num(p.files)) };
}

function cleanLatest(l) {
  if (!l || typeof l !== 'object' || !isMs(l.at)) return null;
  return {
    at: l.at,
    live: num(l.live),
    hidden: num(l.hidden),
    files: Math.floor(num(l.files)),
    hiddenVersions: Math.floor(num(l.hiddenVersions)),
    ...(typeof l.restrictedTo === 'string' && l.restrictedTo && { restrictedTo: l.restrictedTo.slice(0, 200) }),
    prefixes: (Array.isArray(l.prefixes) ? l.prefixes : [])
      .filter((p) => p && typeof p.name === 'string' && p.name)
      .slice(0, PREFIX_MAX + 1)
      .map((p) => ({
        name: p.name.slice(0, 120),
        bytes: num(p.bytes),
        files: Math.floor(num(p.files)),
        lastUpload: num(p.lastUpload),
      })),
  };
}

const UTC_DAY = (t) => Math.floor(t / 86_400_000);

/**
 * The saved samples (data/b2-usage.json): `{ bucket, latest, history, error }`.
 * A file for another bucket, or one that does not parse, is no history.
 *
 * @param {{ path?: string, bucket: string, write?: Function, logger?: any }} opts
 */
export function createB2Store({ path = STORE_PATH, bucket, write = atomicWriteFileSync, logger = defaultLog }) {
  let state = { bucket, latest: null, history: [], error: null };
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (raw && typeof raw === 'object' && raw.bucket === bucket) {
        state = {
          bucket,
          latest: cleanLatest(raw.latest),
          history: (Array.isArray(raw.history) ? raw.history : [])
            .map(cleanPoint)
            .filter(Boolean)
            .sort((a, b) => a.t - b.t)
            .slice(-HISTORY_MAX),
          error:
            raw.error && (raw.error.kind === 'auth' || raw.error.kind === 'other') && isMs(raw.error.at)
              ? { kind: raw.error.kind, at: raw.error.at }
              : null,
        };
      }
    }
  } catch {
    // An unreadable file is no history.
  }
  const save = () => {
    try {
      mkdirSync(dirname(path), { recursive: true });
      write(path, JSON.stringify(state));
    } catch (err) {
      logger.error({ err }, 'could not save the B2 usage samples');
    }
  };
  return {
    state: () => state,
    /** @param {number} at @param {ReturnType<ReturnType<typeof createTally>['result']>} s */
    recordSuccess(at, s) {
      const point = { t: at, live: s.liveBytes, hidden: s.hiddenBytes, files: s.files };
      const last = state.history[state.history.length - 1];
      // One point a day: a second sample the same UTC day replaces the first.
      const history =
        last && UTC_DAY(last.t) === UTC_DAY(at) ? [...state.history.slice(0, -1), point] : [...state.history, point];
      state = {
        bucket,
        latest: {
          at,
          live: s.liveBytes,
          hidden: s.hiddenBytes,
          files: s.files,
          hiddenVersions: s.hiddenVersions,
          prefixes: s.prefixes,
          ...(s.restrictedTo && { restrictedTo: s.restrictedTo }),
        },
        history: history.slice(-HISTORY_MAX),
        error: null,
      };
      save();
    },
    recordFailure(at, kind) {
      state = { ...state, error: { kind, at } };
      save();
    },
  };
}

/**
 * The job: one run at a time, once a day, backing off after a failure.
 *
 * @param {{ client: { sample: () => Promise<any> }, store: ReturnType<typeof createB2Store>,
 *   logger?: any, now?: () => number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} deps
 */
export function createB2Job({ client, store, logger = defaultLog, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let inFlight = null;
  let failures = 0;
  let stopped = false;

  const backoffFor = (kind) => {
    const [first, ceiling] = BACKOFF_MS[kind];
    return Math.min(ceiling, first * 2 ** Math.max(0, failures - 1));
  };
  const schedule = (ms) => {
    if (stopped) return;
    clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void run();
    }, ms);
    timer.unref?.();
  };

  /** One run now, or the one already running. Never throws. */
  function run() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const at = now();
      try {
        const s = await client.sample();
        const recovered = failures > 0;
        failures = 0;
        store.recordSuccess(at, s);
        if (recovered) logger.info('B2 usage check works again');
        schedule(RUN_EVERY_MS);
      } catch (err) {
        failures += 1;
        const kind = err instanceof B2Error ? err.kind : 'other';
        store.recordFailure(at, kind);
        const wait = err instanceof B2Error && err.retryAfterMs ? err.retryAfterMs : backoffFor(kind);
        // One warning per attempt, and attempts are a backoff window apart.
        logger.warn(
          { kind, retryInMinutes: Math.round(wait / 60_000) },
          kind === 'auth'
            ? 'B2 key rejected: check JAGHELM_B2_KEY_ID and JAGHELM_B2_APP_KEY (a read-only key for the bucket)'
            : `B2 usage check failed: ${err instanceof B2Error ? err.message : 'unexpected error'}`
        );
        schedule(wait);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    /** The first run after BOOT_DELAY_MS, unless a sample is fresh: then at its day's end. */
    start() {
      stopped = false;
      const last = store.state().latest?.at;
      const age = last ? now() - last : Infinity;
      const failed = store.state().error;
      schedule(age < FRESH_MS && !failed ? Math.max(BOOT_DELAY_MS, RUN_EVERY_MS - age) : BOOT_DELAY_MS);
    },
    stop() {
      stopped = true;
      clearTimer(timer);
      timer = null;
    },
    run,
    inFlight: () => inFlight !== null,
  };
}

/**
 * The sparkline's points and the week's change, from the saved history: the
 * change is the latest point against the oldest one within 8 days, and only
 * when that one is at least 6 days back (less is no week).
 *
 * @param {{ t: number, live: number }[]} history
 */
export function weekChange(history) {
  const last = history[history.length - 1];
  if (!last) return null;
  const DAY = 86_400_000;
  const base = history.find((p) => last.t - p.t <= 8 * DAY && last.t - p.t >= 6 * DAY);
  return base ? last.live - base.live : null;
}

/** @type {{ store: ReturnType<typeof createB2Store>, job: ReturnType<typeof createB2Job> } | null} */
let active = null;

/** What the three variables give, or null when any is unset (part 2 absent). */
export function readB2Config() {
  const keyId = envValue('JAGHELM_B2_KEY_ID').trim();
  const appKey = envValue('JAGHELM_B2_APP_KEY');
  const bucket = envValue('JAGHELM_B2_BUCKET').trim();
  const set = [keyId, appKey, bucket].filter(Boolean).length;
  return set === 3 ? { keyId, appKey, bucket, partial: false } : { partial: set > 0 };
}

/** Called once at boot: starts the daily job when the three variables are set. */
export function startB2Usage({ logger = defaultLog, deps = {} } = {}) {
  stopB2Usage();
  const cfg = readB2Config();
  if (!cfg.bucket) {
    if (cfg.partial) {
      logger.warn('B2 bucket size off: set all of JAGHELM_B2_KEY_ID, JAGHELM_B2_APP_KEY and JAGHELM_B2_BUCKET');
    }
    return null;
  }
  const store = deps.store ?? createB2Store({ bucket: cfg.bucket, logger });
  const client = deps.client ?? createB2Client(cfg);
  const job = createB2Job({ client, store, logger, ...deps.job });
  active = { store, job };
  job.start();
  return active;
}

export function stopB2Usage() {
  active?.job.stop();
  active = null;
}

/**
 * Part 2 of GET /api/backups: `{ configured: false }` without the variables;
 * otherwise what the store holds. Never asks Backblaze.
 */
export function b2Answer() {
  if (!active) return { configured: false };
  const s = active.store.state();
  const base = { configured: true, bucket: s.bucket };
  if (!s.latest) {
    return { ...base, pending: !s.error, error: errorWord(s.error), checkedAt: null };
  }
  return {
    ...base,
    pending: false,
    error: errorWord(s.error),
    checkedAt: s.latest.at,
    liveBytes: s.latest.live,
    hiddenBytes: s.latest.hidden,
    hiddenVersions: s.latest.hiddenVersions,
    files: s.latest.files,
    weekChangeBytes: weekChange(s.history),
    history: s.history.map((p) => [p.t, p.live]),
    prefixes: s.latest.prefixes,
    ...(s.latest.restrictedTo && { restrictedTo: s.latest.restrictedTo }),
  };
}

/** @param {{ kind: string } | null} e */
function errorWord(e) {
  if (!e) return null;
  return e.kind === 'auth' ? 'key-rejected' : 'unreachable';
}
