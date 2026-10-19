// @ts-check
/**
 * JagHelm Icon Index
 *
 * The icon picker searches the SVG names of two GitHub icon repositories:
 * - homarr-labs/dashboard-icons (primary; wins when both have a name)
 * - selfhst/icons
 * Icons are served via the jsDelivr CDN, so only the names are kept.
 *
 * The index is names-only and persisted to `icon-index.json` in the data dir,
 * so boot makes no request to GitHub: initIconIndex() only reads that file
 * (#242; boot used to download 12.4 MB of recursive git trees every time).
 * GitHub is asked by the first icon search after the index is missing or a day
 * old, and then only for each repository's svg/ directory (about 2.5 MB, 0.5 MB
 * compressed), conditionally on the ETag it last returned, so an unchanged
 * directory costs a bodyless 304. A search waits for that only when there is no
 * index at all; otherwise it is answered from the index it has while the
 * refresh runs. A refresh that fails (network error, rate limit, a body over
 * the cap, or a listing with no icons) keeps the index it had, logs once, and
 * is not retried for an hour. The unauthenticated API allows 60 requests an
 * hour per IP and counts a 304 too; this makes two a day at most, or two an
 * hour while refreshes fail and icons are being searched. Demo mode never
 * reaches the search route, so it never asks GitHub at all.
 */

import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteFileSync } from './util/atomicWrite.js';
import { DATA_DIR } from './util/dataDir.js';
import { fetchSafe } from './util/safeFetchCore.js';
import { createLogger } from './util/logger.js';
import { VERSION } from './version.js';

const log = createLogger('icons');

export const ICON_INDEX_FILE = 'icon-index.json';
const FILE_VERSION = 1;
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
/** A listing's body cap. selfhst's svg/ listing, the larger, is 1.6 MB today. */
export const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_ICONS_PER_REPO = 50000;
const MAX_ETAG = 256;
// Every name in both repositories today matches; anything else (a path, a space,
// markup) is dropped rather than built into a CDN URL.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/**
 * @typedef {{ id: string, label: string, repo: string, branch: string, dir: string, cdnBase: string, ext: string }} IconRepo
 * @typedef {{ etag: string | null, checkedAt: number, slugs: string[] }} RepoState
 * @typedef {{ slug: string, name: string, repo: IconRepo }} IconEntry
 * @typedef {{ ok: true, etag: string | null, slugs: string[] | null } | { ok: false, repo: string, status?: number, error: string }} ListingResult
 */

/** @type {IconRepo[]} */
const ICON_REPOS = [
  {
    id: 'dashboard-icons',
    label: 'Dashboard Icons',
    repo: 'homarr-labs/dashboard-icons',
    branch: 'main',
    dir: 'svg',
    cdnBase: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg',
    ext: '.svg',
  },
  {
    id: 'selfhst',
    label: 'selfh.st Icons',
    repo: 'selfhst/icons',
    branch: 'main',
    dir: 'svg',
    cdnBase: 'https://cdn.jsdelivr.net/gh/selfhst/icons@latest/svg',
    ext: '.svg',
  },
];

const collator = new Intl.Collator();

let dataDir = DATA_DIR;
let now = Date.now;
/** @type {Map<string, RepoState>} what is persisted, per repository id */
let repoState = new Map();
/** @type {IconEntry[]} deduplicated and sorted by name */
let iconIndex = [];
/** @type {Promise<void> | null} the read of the persisted file */
let loading = null;
/** @type {Promise<void> | null} the refresh in flight */
let refreshing = null;
let retryAt = 0;
let failureLogged = false;

const indexPath = () => join(dataDir, ICON_INDEX_FILE);

/** "home-assistant" -> "Home Assistant" @param {string} slug */
const toName = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (/** @type {string} */ c) => c.toUpperCase());

/** @param {unknown} list @returns {string[]} */
function cleanSlugs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (typeof s === 'string' && SLUG_RE.test(s)) out.push(s);
    if (out.length >= MAX_ICONS_PER_REPO) break;
  }
  return out;
}

function rebuild() {
  /** @type {IconEntry[]} */
  const all = [];
  const seen = new Set();
  for (const repo of ICON_REPOS) {
    for (const slug of repoState.get(repo.id)?.slugs ?? []) {
      if (seen.has(slug)) continue;
      seen.add(slug);
      all.push({ slug, name: toName(slug), repo });
    }
  }
  all.sort((a, b) => collator.compare(a.name, b.name));
  iconIndex = all;
}

/** Read the persisted index. Never throws: a missing or unreadable file is an empty index. */
async function loadPersisted() {
  let text;
  try {
    text = await readFile(indexPath(), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      log.info('no icon index yet; the first icon search builds it');
    } else {
      log.warn({ err }, 'icon index unreadable; the next icon search rebuilds it');
    }
    return;
  }
  let file;
  try {
    file = JSON.parse(text);
  } catch (err) {
    log.warn({ err }, 'icon index is not valid JSON; the next icon search rebuilds it');
    return;
  }
  if (!file || file.version !== FILE_VERSION || !file.repos || typeof file.repos !== 'object') return;
  const t = now();
  for (const repo of ICON_REPOS) {
    const r = Object.hasOwn(file.repos, repo.id) ? file.repos[repo.id] : null;
    if (!r || typeof r !== 'object') continue;
    const slugs = cleanSlugs(r.slugs);
    if (!slugs.length) continue;
    const etag = typeof r.etag === 'string' && r.etag.length <= MAX_ETAG ? r.etag : null;
    // A checkedAt from the future would postpone the refresh indefinitely: count it as stale.
    const checkedAt = Number.isFinite(r.checkedAt) && r.checkedAt <= t ? r.checkedAt : 0;
    repoState.set(repo.id, { etag, checkedAt, slugs });
  }
  rebuild();
  log.info({ count: iconIndex.length }, 'icon index loaded');
}

function persist() {
  /** @type {Record<string, RepoState>} */
  const repos = {};
  for (const [id, s] of repoState) repos[id] = s;
  try {
    mkdirSync(dataDir, { recursive: true });
    atomicWriteFileSync(indexPath(), JSON.stringify({ version: FILE_VERSION, repos }));
  } catch (err) {
    log.warn({ err }, 'could not save the icon index; it is kept in memory');
  }
}

/**
 * List one repository's icon directory, conditionally on the last ETag if there
 * is one. Never throws.
 * @param {IconRepo} repo
 * @returns {Promise<ListingResult>}
 */
async function fetchListing(repo) {
  const prev = repoState.get(repo.id);
  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': `JagHelm/${VERSION}` };
  if (prev?.etag) headers['If-None-Match'] = prev.etag;
  /** @type {(error: string, status?: number) => ListingResult} */
  const fail = (error, status) => ({ ok: false, repo: repo.repo, error, ...(status ? { status } : {}) });
  try {
    // `<branch>:<dir>` names the directory's own tree, so this lists svg/ alone
    // instead of the whole repository's recursive tree.
    const res = await fetchSafe(
      `https://api.github.com/repos/${repo.repo}/git/trees/${repo.branch}:${repo.dir}`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      { trusted: true, maxBytes: MAX_LISTING_BYTES }
    );
    const etag = res.headers.get('etag');
    const keepEtag = etag && etag.length <= MAX_ETAG ? etag : null;
    if (res.status === 304) {
      if (!prev) return fail('304 for a listing it does not have', 304);
      return { ok: true, etag: keepEtag ?? prev.etag, slugs: null };
    }
    if (!res.ok) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      return fail(remaining === '0' ? 'GitHub API rate limit reached' : `GitHub API returned ${res.status}`, res.status);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.tree)) return fail('response is not a directory listing');
    /** @type {Array<{ type?: unknown, path?: unknown } | null>} */
    const tree = data.tree;
    const slugs = cleanSlugs(tree.flatMap((item) =>
      item?.type === 'blob' && typeof item.path === 'string' && item.path.endsWith(repo.ext)
        ? [item.path.slice(0, -repo.ext.length)]
        : []));
    if (!slugs.length) return fail('listing has no icons');
    return { ok: true, etag: keepEtag, slugs };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** @param {IconRepo[]} repos the stale ones. Never rejects. */
async function refresh(repos) {
  const results = await Promise.all(repos.map(fetchListing));
  const t = now();
  /** @type {ListingResult[]} */
  const failures = [];
  results.forEach((r, i) => {
    if (!r.ok) {
      failures.push(r);
      return;
    }
    const prev = repoState.get(repos[i].id);
    const slugs = r.slugs ?? prev?.slugs ?? [];
    repoState.set(repos[i].id, { etag: r.etag, checkedAt: t, slugs });
  });
  if (failures.length < results.length) {
    rebuild();
    persist();
  }
  if (failures.length) {
    retryAt = t + RETRY_AFTER_FAILURE_MS;
    // Once per run of failures: a search every few seconds must not log every time.
    if (!failureLogged) {
      failureLogged = true;
      log.warn(
        { failures, count: iconIndex.length, retryAt: new Date(retryAt).toISOString() },
        'icon index refresh failed; serving the index it has'
      );
    }
    return;
  }
  if (failureLogged) log.info('icon index refresh recovered');
  failureLogged = false;
  log.info({ count: iconIndex.length }, 'icon index refreshed');
}

/**
 * Load the persisted index at boot. Reads the data dir only; no network.
 * Resets any in-memory state, so a second call re-reads the file.
 * @param {{ dataDir?: string, now?: () => number }} [opts] tests point these elsewhere
 */
export async function initIconIndex(opts = {}) {
  dataDir = opts.dataDir ?? DATA_DIR;
  now = opts.now ?? Date.now;
  repoState = new Map();
  iconIndex = [];
  refreshing = null;
  retryAt = 0;
  failureLogged = false;
  loading = loadPersisted();
  await loading;
}

/**
 * Called before each icon search. Loads the persisted index if boot hasn't, and
 * starts a refresh of the repositories that are missing or a day old (unless one
 * is running or failed within the hour). Waits for it only while the index is
 * empty. Never rejects.
 */
export async function ensureIconIndex() {
  await (loading ??= loadPersisted());
  const t = now();
  const stale = ICON_REPOS.filter((repo) => {
    const s = repoState.get(repo.id);
    return !s || t - s.checkedAt >= REFRESH_INTERVAL_MS;
  });
  if (stale.length && !refreshing && t >= retryAt) {
    refreshing = refresh(stale).finally(() => {
      refreshing = null;
    });
  }
  if (!iconIndex.length && refreshing) await refreshing;
}

/** Tests: resolves when no refresh is in flight. */
export function _iconRefreshSettled() {
  return refreshing ?? Promise.resolve();
}

/** @param {IconEntry} icon */
function toResult(icon) {
  const { slug, name, repo } = icon;
  return { name, slug, url: `${repo.cdnBase}/${slug}${repo.ext}`, repo: repo.id, repoLabel: repo.label };
}

/**
 * Search icons by query string.
 * Returns up to `limit` matching icons.
 * @param {string} query
 * @param {number} [limit]
 */
export function searchIcons(query, limit = 50) {
  if (!query) return iconIndex.slice(0, limit).map(toResult);

  const q = query.toLowerCase();
  const results = [];
  for (const icon of iconIndex) {
    if (results.length >= limit) break;
    if (icon.slug.includes(q) || icon.name.toLowerCase().includes(q)) results.push(toResult(icon));
  }
  return results;
}

/**
 * Get total icon count.
 */
export function getIconCount() {
  return iconIndex.length;
}
