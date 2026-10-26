/**
 * The expiry tracker (#676): what GET /api/expiry serves, and the background
 * check behind it.
 *
 * Two sources, each absent unless set up, and a shape that takes more later
 * (one more producer of items, one more entry in `expiryAnswer`):
 *  - TLS certificates: the targets Settings keeps (display-config.json
 *    `expiry.tls`, host or host:port, at most 30). A real handshake with each
 *    (tlsExpiry.js) once at boot after START_DELAY_MS, then every CHECK_EVERY_MS.
 *    A target with no result yet (just added in Settings) is checked at once,
 *    so the row is not empty for six hours. Results live in memory.
 *  - Tailscale node keys (tailscaleExpiry.js), when JAGHELM_TAILSCALE_API_KEY
 *    is set; cached 6 hours.
 *
 * The server states facts (`state`, `daysLeft`, `expires`); the colours are
 * the web's, against the lines Settings keeps (`expiryDays`).
 * Days are worked out here, when the answer is built, from the end date, so a
 * result kept for hours is never a stale count. Nothing here alerts.
 *
 * Also offered, never added by itself: the https hosts in services.yaml's
 * integration URLs, as `suggestions` for Settings' one-click "Track".
 */
import { readDisplayConfig } from './refresh.js';
import { getConfig } from './config.js';
import { cleanTargets, parseTarget } from './expiryTargets.js';
import { isRetiredEntry } from './integrations/registry.js';
import { probeTls } from './tlsExpiry.js';
import { tailscaleAnswer } from './tailscaleExpiry.js';
import { createLogger } from './util/logger.js';

const log = createLogger('expiry');

export const START_DELAY_MS = 60_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;
const CONCURRENCY = 5;
const MAX_SUGGESTIONS = 20;
const DAY_MS = 86_400_000;

/** key -> the last probe result */
const results = new Map();
/** keys being checked now */
const running = new Set();
let timer = null;
let stopped = true;

/** Forget what was read (tests). */
export function _resetExpiry() {
  results.clear();
  running.clear();
  stop();
}

/** The TLS targets saved in Settings, clean and in order. */
export function savedTargets() {
  return cleanTargets(readDisplayConfig()?.expiry?.tls);
}

/** Run `fn` over `items`, `limit` at a time. */
async function pool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    })
  );
}

/** Check `keys` (those not already being checked) and keep the results. */
export async function checkTargets(keys, probe = probeTls) {
  const todo = keys.filter((k) => !running.has(k));
  todo.forEach((k) => running.add(k));
  await pool(todo, CONCURRENCY, async (key) => {
    try {
      results.set(key, await probe(key));
    } catch (err) {
      // probeTls never throws; a stand-in that does must not stop the others.
      log.debug({ err: String(err?.message || err), target: key }, 'TLS check failed');
      results.set(key, { state: 'handshake_failed', notAfter: null, issuer: null, code: null, checkedAt: Date.now() });
    } finally {
      running.delete(key);
    }
  });
}

async function runChecks(probe) {
  const keys = savedTargets();
  if (keys.length > 0) await checkTargets(keys, probe);
  // Warm the Tailscale read (cached; a no-op without a key).
  await tailscaleAnswer().catch(() => {});
  log.debug({ targets: keys.length }, 'expiry checks done');
}

/**
 * Start the background check: once after `delayMs`, then every `everyMs`.
 * Only boot() calls it; importing this module starts nothing.
 */
export function startExpiryChecks({ delayMs = START_DELAY_MS, everyMs = CHECK_EVERY_MS, probe } = {}) {
  stop();
  stopped = false;
  const tick = (wait) => {
    timer = setTimeout(async () => {
      try {
        await runChecks(probe);
      } catch (err) {
        log.warn({ err: String(err?.message || err) }, 'expiry checks failed');
      }
      if (!stopped) tick(everyMs);
    }, wait);
    timer.unref?.();
  };
  tick(delayMs);
}

function stop() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
export { stop as stopExpiryChecks };

/** The https hosts of services.yaml's integration URLs not tracked yet. */
export function suggestedTargets(tracked) {
  const have = new Set(tracked);
  const out = new Set();
  const integrations = getConfig()?.integrations;
  for (const [key, entry] of Object.entries(integrations && typeof integrations === 'object' ? integrations : {})) {
    if (isRetiredEntry(key, entry)) continue;
    const raw = entry && typeof entry === 'object' ? entry.url : null;
    if (typeof raw !== 'string' || !URL.canParse(raw)) continue;
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) continue;
    const host = u.hostname.startsWith('[') || !u.hostname.includes(':') ? u.hostname : `[${u.hostname}]`;
    const t = parseTarget(u.port ? `${host}:${u.port}` : host);
    if (t && !have.has(t.key)) out.add(t.key);
    if (out.size >= MAX_SUGGESTIONS) break;
  }
  return [...out];
}

/** Whole days between now and `at` (negative once past), or null. */
function daysUntil(at, now) {
  if (typeof at !== 'string') return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.trunc((t - now) / DAY_MS) : null;
}

/** The state of an item with an end date: its dates move on after it is read. */
const dated = (at, now) => (Date.parse(at) < now ? 'expired' : 'ok');

function tlsItem(key, result, now) {
  if (!result) {
    return { id: `tls:${key}`, source: 'tls', name: key, detail: null, state: 'checking', daysLeft: null, expires: null };
  }
  const has = typeof result.notAfter === 'string';
  return {
    id: `tls:${key}`,
    source: 'tls',
    name: key,
    detail: result.issuer ? `Issued by ${result.issuer}` : null,
    state: has ? dated(result.notAfter, now) : result.state,
    daysLeft: has ? daysUntil(result.notAfter, now) : null,
    expires: has ? result.notAfter : null,
    mismatch: result.mismatch === true,
  };
}

function keyItem(d, now) {
  const has = typeof d.expires === 'string';
  return {
    id: `ts:${d.id}`,
    source: 'tailscale',
    name: d.name,
    detail: 'Tailscale node key',
    state: has ? dated(d.expires, now) : 'unknown',
    daysLeft: has ? daysUntil(d.expires, now) : null,
    expires: has ? d.expires : null,
  };
}

/**
 * The answer: `{ configured, items, noExpiry, tailscale, suggestions }`.
 * `configured` is false with no TLS target and no Tailscale key (the Overview
 * draws nothing). `items` are soonest first, undated ones last;
 * `noExpiry` is `{ count, names }` for the Tailscale devices whose key never
 * expires, or null; `offline` lists devices whose key expired and that have not
 * been seen for 30 days (`{ name, lastSeen }`), apart from the items; `tailscale` is `{ configured, state, stale? }`.
 * Never throws.
 *
 * @param {number} [now]
 * @param {{ probe?: typeof probeTls, fetchImpl?: typeof fetch }} [deps]  tests
 */
export async function expiryAnswer(now = Date.now(), deps = {}) {
  const keys = savedTargets();
  for (const k of results.keys()) if (!keys.includes(k)) results.delete(k);
  const fresh = keys.filter((k) => !results.has(k) && !running.has(k));
  if (fresh.length > 0) {
    // Not waited for: the row says "checking" until its handshake is done.
    checkTargets(fresh, deps.probe).catch(() => {});
  }
  const items = keys.map((k) => tlsItem(k, results.get(k), now));
  let tailscale = { configured: false };
  let noExpiry = null;
  let offline = [];
  const ts = await tailscaleAnswer(now, deps.fetchImpl).catch(() => null);
  if (ts) {
    tailscale = { configured: true, state: ts.state, ...(ts.stale ? { stale: true } : {}) };
    for (const d of ts.keyed) items.push(keyItem(d, now));
    offline = ts.offline ?? [];
    if (ts.noExpiry.count > 0) noExpiry = { count: ts.noExpiry.count, names: ts.noExpiry.names };
  }
  items.sort(
    (a, b) =>
      (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name)
  );
  return {
    configured: keys.length > 0 || tailscale.configured,
    items,
    noExpiry,
    offline,
    tailscale,
    suggestions: suggestedTargets(keys),
  };
}
