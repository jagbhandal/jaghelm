// @ts-check
/**
 * The icon repositories the local icon cache (`/api/icons/cached`, icon-cache.js)
 * fetches from, and the one function that decides it: canonicalIconUrl() turns
 * the URL a browser asks for into the URL the server fetches and keys the cache
 * by, or null for anything else (#255).
 *
 * The endpoint is unauthenticated, so this is what bounds what anyone who can
 * reach the port can make the server download and keep: an icon file of one of
 * the two repositories the icon picker searches (server/icons.js), as an SVG,
 * PNG or WebP, at a moving ref (jsDelivr's `@latest` or `@main`, or the `main`
 * or `HEAD` branch on raw.githubusercontent.com). A pinned tag or commit would
 * make every icon cacheable once per tag and commit, so those are not cached;
 * neither is anything else. The fetched URL is rebuilt from the constants
 * here and a lowercase file name, never passed through: a query string,
 * fragment, letter case in the host or repository name, the default port, an
 * omitted jsDelivr ref and the repository's old name all collapse to one URL,
 * and so to one cache file.
 *
 * Dependency-free on purpose: the web client imports it (src/hooks/useData.js)
 * to send only these URLs through the cache. Any other icon URL the client is
 * given it loads directly, as before the cache existed.
 */

/** The file types cached, by extension, with the Content-Type both CDNs send for them. */
export const ICON_TYPES = Object.freeze({
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

/** Longer input is refused before parsing. Every accepted URL is under 300 characters. */
export const MAX_ICON_URL_LENGTH = 2048;

/**
 * GitHub `owner/repo`, lowercase (GitHub and jsDelivr ignore case in both), to the
 * name the cache fetches it by. `walkxcode/dashboard-icons` is Dashboard Icons'
 * name before it moved to homarr-labs: GitHub redirects it and jsDelivr serves
 * the same files under it, and JagHelm itself built URLs with it until 2026-06.
 * @type {Readonly<Record<string, string>>}
 */
const REPOS = Object.freeze({
  'homarr-labs/dashboard-icons': 'homarr-labs/dashboard-icons',
  'walkxcode/dashboard-icons': 'homarr-labs/dashboard-icons',
  'selfhst/icons': 'selfhst/icons',
});

/** @param {string} ownerRepo @returns {string | undefined} */
const repoNamed = (ownerRepo) => {
  const key = ownerRepo.toLowerCase();
  return Object.hasOwn(REPOS, key) ? REPOS[key] : undefined;
};

/** Each repository keeps one directory per file type, named after it. */
const DIR_EXT = Object.freeze({ svg: '.svg', png: '.png', webp: '.webp' });

/**
 * Refs that follow the repository rather than pin one version of it. jsDelivr
 * treats a missing ref as `latest`.
 */
const JSDELIVR_REFS = new Set(['latest', 'main']);
const RAW_REFS = new Set(['main', 'HEAD']);

// Every file name in both repositories matches (lowercase, as icons.js's SLUG_RE allows).
const FILE_RE = /^[a-z0-9][a-z0-9._-]{0,127}\.(svg|png|webp)$/;
// Printable ASCII only: no whitespace, control characters or non-ASCII look-alikes.
const PRINTABLE_RE = /^[\x21-\x7e]+$/;

/**
 * @param {string} dir
 * @param {string} file
 * @returns {string | null} the file name when it is an icon of that directory's type
 */
function iconFile(dir, file) {
  const ext = Object.hasOwn(DIR_EXT, dir) ? DIR_EXT[/** @type {keyof typeof DIR_EXT} */ (dir)] : null;
  return ext && FILE_RE.test(file) && file.endsWith(ext) ? file : null;
}

/**
 * The URL to fetch and cache `raw` as, or null when it is not an icon of an
 * allowed repository. Never throws.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function canonicalIconUrl(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_ICON_URL_LENGTH) return null;
  if (!PRINTABLE_RE.test(raw) || raw.includes('\\')) return null;
  // Checked on the input, before the URL parser would resolve them: no
  // percent-escape (an accepted URL never needs one, and the parser decodes
  // %2e as a dot segment), and no `.` or `..` segment.
  const beforeQuery = raw.split(/[?#]/, 1)[0];
  if (beforeQuery.includes('%')) return null;
  if (beforeQuery.split('/').some((s) => s === '.' || s === '..')) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // The parser lowercases the host and drops the default port (443) itself.
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const seg = url.pathname.split('/');

  if (url.hostname === 'cdn.jsdelivr.net') {
    // /gh/<owner>/<repo>[@<ref>]/<dir>/<file>
    if (seg.length !== 6 || seg[0] !== '' || seg[1] !== 'gh') return null;
    const [name, ref, extra] = seg[3].split('@');
    if (extra !== undefined) return null;
    const repo = repoNamed(`${seg[2]}/${name}`);
    const canonicalRef = ref === undefined ? 'latest' : ref;
    const file = iconFile(seg[4], seg[5]);
    if (!repo || !JSDELIVR_REFS.has(canonicalRef) || !file) return null;
    return `https://cdn.jsdelivr.net/gh/${repo}@${canonicalRef}/${seg[4]}/${file}`;
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    // /<owner>/<repo>/<ref>/<dir>/<file>
    if (seg.length !== 6 || seg[0] !== '') return null;
    const repo = repoNamed(`${seg[1]}/${seg[2]}`);
    const file = iconFile(seg[4], seg[5]);
    if (!repo || !RAW_REFS.has(seg[3]) || !file) return null;
    return `https://raw.githubusercontent.com/${repo}/${seg[3]}/${seg[4]}/${file}`;
  }

  return null;
}

/**
 * Where else the same icon lives: the raw.githubusercontent.com URL of a jsDelivr
 * icon (#371). jsDelivr refuses packages over 50 MB and Dashboard Icons is one, so
 * it intermittently answers 403 for an icon that exists. The result is always an
 * accepted URL, on a host the CSP already allows. Null for any other URL,
 * raw.githubusercontent.com ones included.
 * @param {unknown} raw
 * @returns {string | null}
 */
export function rawFallbackUrl(raw) {
  const canonical = canonicalIconUrl(raw);
  if (!canonical) return null;
  const url = new URL(canonical);
  if (url.hostname !== 'cdn.jsdelivr.net') return null;
  const seg = url.pathname.split('/'); // '', 'gh', owner, repo@ref, dir, file
  const repo = seg[3].split('@')[0];
  return `https://raw.githubusercontent.com/${seg[2]}/${repo}/main/${seg[4]}/${seg[5]}`;
}
