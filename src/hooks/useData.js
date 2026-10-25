import { apiFetch, isReadOnlyServer } from '../api/client.js';
import { iconSlugUrl } from '../utils/iconCdn.js';
import { getApiBase } from '../api/baseUrl.js';
import { refreshHints } from '../pollSchedule.js';
// The server's own allowlist (dependency-free), so the client sends the cache
// exactly the URLs it accepts.
import { canonicalIconUrl } from '../../server/icon-sources.js';

// url → { etag, body, modified, date, seq }: the last 200 whose body parsed,
// the ETag, Last-Modified and Date it came with (null when it had none), and
// the request's place in send order. Written in one step, after the parse, so the ETag sent
// as If-None-Match always describes the body a 304 hands back.
const held = new Map();
// url → when it last answered, a 200 or a 304, by whoever asked (#310): an
// open detail takes the page's answer instead of asking again (lastAnswer).
const answeredAt = new Map();
// Send order: each fetchJson call takes the next number. When requests for one
// URL overlap, the pair from the one sent last is kept, whichever body finishes
// last.
let lastSent = 0;

/**
 * Sentinel for the 304 cold-start edge (304 with no cached 200 body). Distinct
 * from a thrown failure AND from a legitimate `null` 200 payload. Consumers MUST
 * treat it as a success (server confirmed nothing changed) but leave their data
 * untouched — there is no body to apply. Frozen so callers can compare by ===.
 */
export const NOT_MODIFIED_NO_BODY = Object.freeze({ __jaghelm304NoBody: true });

/** How long a read may take before it is given up as failed. */
export const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Fetch JSON with ETag support.
 *
 * The 304-stable-identity contract: on a 304 with a cached prior 200, returns
 * the SAME reference as that 200, so downstream useState(ref) bails on Object.is
 * and the subtree does NOT re-render (no per-30s-refresh re-allocation). Three
 * distinguishable outcomes so callers track per-source health without conflating
 * "unchanged" with "failed":
 *   1. 200 → freshly-parsed body (new reference).
 *   2. 304 with prior body → that prior reference (stable identity).
 *   3. 304 cold-start, no prior body → NOT_MODIFIED_NO_BODY sentinel (still a success).
 *   network error / non-2xx / non-304 / a body that fails to parse → THROWS; the
 *   only path a caller reads as error.
 *
 * The ETag and the body are stored together, only once the body has parsed, so
 * the stored ETag always describes the body held. A 200 whose body is empty,
 * malformed or cut off by the timeout throws and leaves the held pair as it was
 * (with none held, the next request stays unconditional). A 200 without an ETag
 * replaces the pair with no ETag, so the next request is unconditional. When
 * requests for one URL overlap, the newest request's pair wins: an older one
 * that finishes later stores nothing and returns the newer body.
 *
 * Pass skipEtag=true to force a full fetch (used on first load when state is empty).
 * A forced fetch also bypasses AND refreshes the browser's HTTP cache, which may
 * hold a copy of a response the server marked cacheable (/cron/status sends a
 * max-age). `reload` (not `no-store`) writes the fresh response back, so a later
 * polled fetch can't be served the older cached copy (e.g. a just-deleted cron
 * job reappearing for up to max-age).
 */
async function fetchJson(url, skipEtag = false) {
  return (await fetchAnswer(url, skipEtag)).body;
}

/** A response's date header `name`, in ms since the epoch, or null without one it can read. */
function dateOf(r, name) {
  const at = Date.parse(r.headers.get(name) ?? '');
  return Number.isFinite(at) ? at : null;
}

/**
 * fetchJson's answer, `{ body, modified, date }`: the body, and by the
 * server's clock when it says the value was last modified (Last-Modified)
 * and when it answered (Date), from the 200, or the 304 (whose Last-Modified
 * may be later than the held body's: an equal value stored again), in ms
 * since the epoch, or null when it sends none. /api/status sends
 * Last-Modified as when the status was built (#499).
 */
async function fetchAnswer(url, skipEtag = false) {
  const seq = ++lastSent;
  const headers = {};
  const storedEtag = held.get(url)?.etag;
  if (storedEtag && !skipEtag) {
    headers['If-None-Match'] = storedEtag;
  }

  const r = await apiFetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(skipEtag && { cache: 'reload' }),
  });

  // The server's phase-lock hint (#630), on the 304 too.
  refreshHints.note(r.headers.get('X-Next-Refresh-Ms'));

  if (r.status === 304) {
    if (held.has(url)) answeredAt.set(url, Date.now());
    return {
      body: held.has(url) ? held.get(url).body : NOT_MODIFIED_NO_BODY,
      modified: dateOf(r, 'Last-Modified'),
      date: dateOf(r, 'Date'),
    };
  }

  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  // Parse before storing anything: a failed parse throws here and leaves the
  // held pair untouched.
  const body = await r.json();
  const cur = held.get(url);
  // A request sent later already stored its pair: keep it and hand back its
  // body, so the caller doesn't step back to this older one.
  if (cur && cur.seq > seq) return { body: cur.body, modified: cur.modified, date: cur.date };
  const modified = dateOf(r, 'Last-Modified');
  const date = dateOf(r, 'Date');
  held.set(url, { etag: r.headers.get('ETag') || null, body, modified, date, seq });
  answeredAt.set(url, Date.now());
  return { body, modified, date };
}

/**
 * The last answer to `path` (`/services`, under the API's base), whoever asked
 * it: `{ at, body }`, when it came (ms since the epoch, a 200 or a 304) and
 * the body it stands for, or null before one. An open detail (#310) takes the
 * page's answer from here rather than asking the same thing again.
 */
export function lastAnswer(path) {
  const url = `${getApiBase()}${path}`;
  const at = answeredAt.get(url);
  return at != null && held.has(url) ? { at, body: held.get(url).body } : null;
}

/** Forget every answer's time (tests start each case afresh). */
export function forgetAnswers() {
  answeredAt.clear();
}

/**
 * Send a request and parse its JSON body, throwing on a non-2xx status (mirrors
 * the r.ok check fetchJson does for reads) so a failed mutation surfaces as a
 * clear "HTTP 500" instead of being silently swallowed or throwing an opaque
 * JSON-parse error on an HTML error body. A 204 / empty body resolves to null.
 */
async function requestJson(url, opts) {
  const r = await apiFetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// ── A read-only server (the public demo, #248) ───────────────────────────
// It refuses every write, so the helpers below don't send one: the change is
// kept in this tab for the visit, and the matching read answers with it. A
// reload starts again from the server's data.
let localTodos = null;
const removedCronJobs = new Set();
const cronJobKey = (node, job) => JSON.stringify([node, job]);

/** /api/cron/status without the jobs removed in this tab. */
function withoutRemovedCronJobs(statuses) {
  return statuses
    .map((n) => ({
      ...n,
      jobs: n.jobs.filter((j) => !removedCronJobs.has(cronJobKey(n.node, j.job))),
    }))
    .filter((n) => n.jobs.length > 0);
}

/** Forget the changes kept in this tab (tests start each case afresh). */
export function forgetLocalChanges() {
  localTodos = null;
  removedCronJobs.clear();
}

/**
 * Fetch all node + service data in one call.
 * Returns null if data unchanged (304), otherwise:
 * { nodes: { [key]: { display_name, subtitle, icon, border_color, metrics, services } } }
 */
export async function getServices(skipEtag) {
  return fetchJson(`${getApiBase()}/services`, skipEtag);
}

/**
 * The status model (#292): every entity's state, the subsystems, the overall
 * state and sentence, and the ranked issues (docs/ARCHITECTURE.md §4.7). The
 * header polls it (useStatus, #296); a steady board answers 304.
 *
 * Returns `{ body, builtAt, sentAt }`: the body as fetchJson returns it, and,
 * by the server's clock (ms since the epoch, from a 200 or a 304), when it
 * built the status (Last-Modified, #499) and when it answered (Date); each
 * null when the server doesn't say.
 */
export async function getStatus(skipEtag) {
  const { body, modified, date } = await fetchAnswer(`${getApiBase()}/status`, skipEtag);
  return { body, builtAt: modified, sentAt: date };
}

/**
 * A page of the alert history (#267, #314): GET /api/events with `query`
 * (`severity`, `kind`, `q`, `limit`, `before`; one left out when null or
 * empty). Returns `{ events, next }`, newest first, `next` the cursor for the
 * page after or null. Throws "HTTP <status>" on an answer that isn't a 2xx (a
 * server from before #267 has no such route: 404), and on one that isn't a
 * page, so a failed read is never an empty history. Never conditional and
 * never held: the server marks it no-store.
 *
 * @param {Record<string, string | number | null | undefined>} [query]
 * @returns {Promise<{ events: object[], next: string | null }>}
 */
export async function getEvents(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  const url = `${getApiBase()}/events`;
  const r = await apiFetch(search ? `${url}?${search}` : url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  if (!body || !Array.isArray(body.events)) throw new Error('Not a page of the alert history');
  return { events: body.events, next: typeof body.next === 'string' ? body.next : null };
}

// Dashboard display config (refresh cadence + layout flags). This is the SAME
// endpoint the web dashboard reads its `refreshInterval` from, so a client
// can sync its refresh countdown to the exact cadence the web polls at. Display
// settings only — not the secret-bearing service/integration config.
export async function getDisplayConfig(skipEtag) {
  return fetchJson(`${getApiBase()}/display-config`, skipEtag);
}

// Readings over time from Prometheus (#311): `series` (one name, or several
// of one kind, comma-separated), the `entity` (a node's key, `<node>/<container>`,
// or none for every node) and the `range` (1h, 24h or 7d). The server answers a
// whole step from its cache, so a read within the step is a 304.
export async function getHistory({ series, entity, range }, skipEtag) {
  const query = new URLSearchParams({ series, range });
  if (entity != null) query.set('entity', entity);
  return fetchJson(`${getApiBase()}/history?${query}`, skipEtag);
}

// The last error-ish lines of a node (`entity` its key) or a container
// (`<node>/<container>`) from Loki (#672). Never revalidated: the server keeps
// an answer 30 s itself.
export async function getLogs({ entity }) {
  return fetchJson(`${getApiBase()}/logs?${new URLSearchParams({ entity })}`, true);
}

// Days until each node's disk is full (#670), a line fitted by the server to a
// week of Prometheus. The server keeps one answer 10 minutes, so a read within
// that is a 304.
export async function getDiskForecast(skipEtag) {
  return fetchJson(`${getApiBase()}/disk-forecast`, skipEtag);
}

// The unticked rows of homelab-infra #848, the pending host steps (#673), or
// { configured: false } without a Gitea URL and token. The server keeps one
// answer 5 minutes, so a read within that is a 304.
export async function getHostActions(skipEtag) {
  return fetchJson(`${getApiBase()}/host-actions`, skipEtag);
}

// The Backups section (#675): each marked backup job's last good run and the B2
// bucket's saved size samples. Local to the server, so a read is cheap.
export async function getBackups(skipEtag) {
  return fetchJson(`${getApiBase()}/backups`, skipEtag);
}

// Each host's latest config drift report (#674), or { configured: false } when
// no host can push (no JAGHELM_CRON_SECRET). Read with skipEtag: `now` moves.
export async function getDrift(skipEtag) {
  return fetchJson(`${getApiBase()}/drift`, skipEtag);
}

// The UPS's readings. Only read from a server older
// than #549 (board.js needsUpsRead): the web reads the UPS from the status
// model (#586). Goes with /api/ups in Phase 4's endpoint cleanup.
export async function getUPSStatus(skipEtag) {
  return fetchJson(`${getApiBase()}/ups`, skipEtag);
}
export async function getGiteaActivity(skipEtag) {
  return fetchJson(`${getApiBase()}/gitea/activity`, skipEtag);
}
export async function getCronStatus(skipEtag) {
  const statuses = await fetchJson(`${getApiBase()}/cron/status`, skipEtag);
  return removedCronJobs.size && Array.isArray(statuses)
    ? withoutRemovedCronJobs(statuses)
    : statuses;
}

// Phase 3: Integration Engine
export async function getAllIntegrations(skipEtag) {
  return fetchJson(`${getApiBase()}/integrations`, skipEtag);
}
export async function getIntegrationPresets() {
  return fetchJson(`${getApiBase()}/integrations/presets`);
}
export async function testIntegration(data) {
  return requestJson(`${getApiBase()}/integrations/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function saveIntegration(data) {
  return requestJson(`${getApiBase()}/integrations/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export async function deleteIntegration(type) {
  return requestJson(`${getApiBase()}/integrations/${type}`, { method: 'DELETE' });
}

export async function deleteCronJob(node, job) {
  if (isReadOnlyServer()) {
    removedCronJobs.add(cronJobKey(node, job));
    return null;
  }
  // A browser rewrites a "." or ".." path segment before sending it (#578):
  // the request would never reach the job, and its 404 would read as "already
  // gone". The server refuses such names on report since.
  if ([node, job].some((name) => name === '.' || name === '..')) {
    throw Object.assign(new Error('a "." or ".." name has no address'), { code: 'DOT_NAME' });
  }
  const url = `${getApiBase()}/cron/jobs/${encodeURIComponent(node)}/${encodeURIComponent(job)}`;
  try {
    return await requestJson(url, { method: 'DELETE' });
  } catch (err) {
    // 404 = already gone, which is the outcome the caller wanted.
    if (err?.message === 'HTTP 404') return null;
    throw err;
  }
}

/**
 * Forget a missing container (#688): POST /api/containers/forget. The server
 * checks it is missing and not running, forgets it from its registry and runs
 * a cycle, so the next read of the board is without it. Throws `HTTP <status>`
 * when refused (403 no dashboard password, 404 not on the board, 409 running,
 * 429 too many tries).
 */
export async function forgetContainer(node, container) {
  return requestJson(`${getApiBase()}/containers/forget`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node, container }),
  });
}

export async function getWeather(lat, lon) {
  const r = await apiFetch(`${getApiBase()}/weather?lat=${lat}&lon=${lon}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getTodos() {
  if (isReadOnlyServer() && localTodos) return localTodos;
  const r = await apiFetch(`${getApiBase()}/todos`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function saveTodos(todos) {
  if (isReadOnlyServer()) {
    localTodos = todos;
    return;
  }
  // Route through requestJson so a failed save REJECTS (was silently swallowed:
  // the old code awaited the fetch but never checked r.ok, so a 500 looked like
  // a successful save). Caller awaits for completion only; no body is returned.
  await requestJson(`${getApiBase()}/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(todos),
  });
}

export async function uploadFile(file, type) {
  // The image stays in this tab: an object URL for the visit, never sent.
  if (isReadOnlyServer()) return { url: URL.createObjectURL(file) };
  const form = new FormData();
  form.append('file', file);
  // HARNESS-GAP (ledger #1): the one remaining raw '/api' literal that bypasses
  // getApiBase(). Intentionally relative — uploadFile is web-only (mobile does no
  // uploads). Promote through getApiBase() if/when mobile ever uploads.
  const r = await apiFetch(`/api/upload?type=${type}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error('Upload failed');
  return r.json();
}

/**
 * Convert an icon-repository URL to a locally-cached URL.
 * Icons are fetched from the CDN once, saved to icon-cache/ in the data dir,
 * and served locally on all subsequent loads. Eliminates 20-30
 * cross-origin CDN round-trips on every cold page load.
 *
 * Only the URLs the server caches go through it: Dashboard Icons and selfh.st
 * icons on jsDelivr or raw.githubusercontent.com (server/icon-sources.js, #255).
 * Every other URL — another repository, a pinned version, any other host,
 * local paths, data URIs — passes through unchanged and loads directly.
 * Empty strings return null.
 *
 * Base-aware: the proxied URL is built from getApiBase() so on mobile it is an
 * absolute same-base URL that reaches Express over Tailscale. Web is unchanged ('/api').
 */
export function cachedIconUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (canonicalIconUrl(url)) {
    return `${getApiBase()}/icons/cached?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export const WEATHER_CODES = {
  0: { icon: '☀️', label: 'Clear' },
  1: { icon: '🌤', label: 'Mostly Clear' },
  2: { icon: '⛅', label: 'Partly Cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫', label: 'Foggy' },
  48: { icon: '🌫', label: 'Rime Fog' },
  51: { icon: '🌦', label: 'Light Drizzle' },
  53: { icon: '🌦', label: 'Drizzle' },
  55: { icon: '🌧', label: 'Heavy Drizzle' },
  61: { icon: '🌧', label: 'Light Rain' },
  63: { icon: '🌧', label: 'Rain' },
  65: { icon: '🌧', label: 'Heavy Rain' },
  71: { icon: '🌨', label: 'Light Snow' },
  73: { icon: '🌨', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy Snow' },
  80: { icon: '🌦', label: 'Showers' },
  81: { icon: '🌧', label: 'Heavy Showers' },
  95: { icon: '⛈', label: 'Thunderstorm' },
};

export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=' },
  { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/search?query=' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
];

export const SERVICE_ICONS = {
  npm: 'nginx-proxy-manager',
  nginx: 'nginx-proxy-manager',
  adguard: 'adguard-home',
  photoprism: 'photoprism',
  photos: 'photoprism',
  vaultwarden: 'vaultwarden',
  vault: 'vaultwarden',
  gitea: 'gitea',
  nextcloud: 'nextcloud',
  cloud: 'nextcloud',
  grafana: 'grafana',
  proxmox: 'proxmox',
  dockge: 'dockge',
  uptime: 'uptime-kuma',
  kuma: 'uptime-kuma',
  code: 'vscode',
  'vs code': 'vscode',
  cloudflare: 'cloudflare',
  tunnel: 'cloudflare',
  tailscale: 'tailscale',
  prometheus: 'prometheus',
  nas: 'nas',
  synology: 'synology',
  ugreen: 'nas',
  ntfy: 'ntfy',
  homebridge: 'homebridge',
  plex: 'plex',
  jellyfin: 'jellyfin',
  pihole: 'pi-hole',
  sonarr: 'sonarr',
  radarr: 'radarr',
  portainer: 'portainer',
  wireguard: 'wireguard',
  backrest: 'backrest',
  casaos: 'casaos',
  collabora: 'collabora-online',
  watchtower: 'watchtower',
  nut: 'nut',
  homepage: 'homepage',
  jaghelm: '/logo.svg',
};

// SERVICE_ICONS entries sorted by key length DESCENDING. getServiceIcon does a
// substring match, so a shorter key can shadow a longer, more-specific one if we
// iterate in insertion order (e.g. "nas" would match "synology-nas"/"nasa"
// before "synology" ever gets a chance). Matching the LONGEST key first makes the
// result independent of object-literal order and picks the most specific icon.
const SERVICE_ICONS_BY_KEY_LENGTH = Object.entries(SERVICE_ICONS).sort(
  ([a], [b]) => b.length - a.length
);

export function getServiceIcon(name) {
  const lower = (name || '').toLowerCase();
  for (const [key, slug] of SERVICE_ICONS_BY_KEY_LENGTH) {
    // jaghelm is a local asset path; every other value is a Dashboard Icons slug.
    if (lower.includes(key)) return cachedIconUrl(slug.startsWith('/') ? slug : iconSlugUrl(slug));
  }
  return null;
}
