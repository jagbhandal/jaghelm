/**
 * Pending host steps (#673): what GET /api/host-actions serves.
 *
 * homelab-infra issue #848 is a pinned running list of the PRs that only take
 * effect once someone acts on a host: a markdown checklist, ticked when the
 * step is done. JagHelm reads that one issue (read-only) and counts the
 * unticked rows, so "Pending host steps: 3" is on the Overview without
 * opening Gitea.
 *
 * Set up only when JAGHELM_GITEA_URL and JAGHELM_GITEA_TOKEN are both set (the
 * Pipeline panel's pair; the token only needs to read homelab-infra's issues).
 * Either unset, or a URL JagHelm refuses (sourceUrls.js), and the answer is
 * `{ configured: false }`: the tile is absent, never an error. The token goes
 * in the Authorization header only, never in a URL, and no log line carries it.
 *
 * One answer is kept CACHE_TTL_MS and shared by every reader; a failed read is
 * asked again after FAILURE_TTL_MS, and the last good list keeps being served
 * (marked `stale`) for STALE_MAX_MS while Gitea doesn't answer. The request
 * has its own short timeout.
 *
 * The body is parsed defensively (parseHostActions): a row is a top-level
 * `- [ ]` line (not indented, not in a code block); its first **bold** text is the reference (`owner/repo#n` or a
 * bare `#n`, in homelab-infra), the words after it the title. A body that is
 * not text, or has no checklist row at all, is not a list we can count: the
 * answer is `ok: false` with the link to #848, never a guess and never a
 * crash.
 */
import { getCached, setCache } from './cache.js';
import { envValue } from './env.js';
import { safeFetch } from './httpClient.js';
import { sourceUrl } from './sourceUrls.js';
import { createLogger } from './util/logger.js';
import { redactSecrets } from './util/redact.js';

const log = createLogger('host-actions');

export const HOST_ACTIONS_REPO = 'jagdeep.bhandal/homelab-infra';
export const HOST_ACTIONS_ISSUE = 848;

/** An answer is kept this long; every reader in that time shares it. */
export const CACHE_TTL_MS = 5 * 60_000;
/** A failed read is kept this long before Gitea is asked again. */
export const FAILURE_TTL_MS = 60_000;
/** The last good list keeps being served this long while Gitea doesn't answer. */
export const STALE_MAX_MS = 30 * 60_000;
/** The request's own timeout. */
export const TIMEOUT_MS = 5_000;
/** Rows the answer lists; the count is always the whole. */
export const MAX_ITEMS = 8;
const TITLE_MAX = 110;
// Larger than any real list; a body past it is cut before it is parsed.
const BODY_MAX = 200_000;

const NOT_CONFIGURED = Object.freeze({ configured: false });
const KEY = 'host-actions';

const REF = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/;

/** Markdown taken out of a row's words: links keep their text, emphasis and code lose their marks. */
function plain(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cut(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * The unticked rows of a checklist body, in the order the list gives them:
 * `{ ok: true, total, items: [{ ref, title, href }] }` (`href` an issue or PR
 * of `base`, or the list itself for a row with no reference), or `{ ok: false
 * }` for what is not a checklist.
 *
 * @param {unknown} body
 * @param {string} base  the Gitea base URL, without a trailing slash
 */
export function parseHostActions(body, base) {
  if (typeof body !== 'string') return { ok: false };
  const listHref = `${base}/${HOST_ACTIONS_REPO}/issues/${HOST_ACTIONS_ISSUE}`;
  let rows = 0;
  const open = [];
  let fenced = false;
  for (const line of body.slice(0, BODY_MAX).split(/\r?\n/)) {
    // A code block (the host blocks in a row) holds no rows, whatever it says.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (!m) continue;
    rows += 1;
    if (m[1] === ' ') open.push(m[2]);
  }
  if (rows === 0) return { ok: false };
  const items = open.map((text) => {
    const bold = /\*\*(.+?)\*\*/.exec(text);
    const refMatch = bold ? REF.exec(plain(bold[1])) : null;
    const rest = bold ? text.slice(bold.index + bold[0].length) : text;
    const title = cut(plain(rest).replace(/^[\s:.\-–—)(]+/, ''), TITLE_MAX);
    if (!refMatch) {
      return { ref: bold ? cut(plain(bold[1]), 60) : null, title, href: listHref };
    }
    const repo = refMatch[1] ?? HOST_ACTIONS_REPO;
    const ref = refMatch[1] ? `${refMatch[1].split('/')[1]}#${refMatch[2]}` : `#${refMatch[2]}`;
    // /issues/<n> opens a pull request's page too: Gitea redirects it.
    return { ref, title, href: `${base}/${repo}/issues/${refMatch[2]}` };
  });
  return { ok: true, total: items.length, items };
}

/** The log text for an error, with the token and any URL credential taken out. */
function errorText(err, token) {
  const raw = String(err?.message || err);
  const clean = redactSecrets(token ? raw.split(token).join('[redacted]') : raw);
  return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
}

// The last good list (with when it was read) and the failure state, in this process.
let lastGood = null;
let failing = false;
let inFlight = null;

/** Let the cached answer lapse, as its TTL would, keeping the last good list (tests). */
export function _expireHostActions() {
  setCache(KEY, null, null, { ttlMs: 0 });
}

/** Forget what was read (tests). */
export function _resetHostActions() {
  lastGood = null;
  failing = false;
  inFlight = null;
  _expireHostActions();
}

function seeLink(base) {
  return `${base}/${HOST_ACTIONS_REPO}/issues/${HOST_ACTIONS_ISSUE}`;
}

async function read(base, token, now) {
  const href = seeLink(base);
  let reason;
  try {
    const res = await safeFetch(
      `${base}/api/v1/repos/${HOST_ACTIONS_REPO}/issues/${HOST_ACTIONS_ISSUE}`,
      {
        headers: { Authorization: `token ${token}`, Accept: 'application/json' },
        timeoutMs: TIMEOUT_MS,
      }
    );
    if (!res.ok) {
      reason = `status ${res.status}`;
    } else {
      let issue;
      try {
        issue = JSON.parse(await res.text());
      } catch {
        issue = undefined;
      }
      const parsed = parseHostActions(issue?.body, base);
      if (parsed.ok) {
        if (failing) log.info('host steps list answers again');
        failing = false;
        const items = parsed.items.slice(0, MAX_ITEMS);
        const body = {
          configured: true,
          ok: true,
          count: parsed.total,
          items,
          more: parsed.total - items.length,
          href,
        };
        lastGood = { body, at: now };
        return { body, ttlMs: CACHE_TTL_MS };
      }
      // Gitea answered, but not with a list we can count: say so, link the issue.
      if (!failing) log.warn('host steps list not understood: issue body has no checklist');
      failing = true;
      lastGood = null;
      return { body: { configured: true, ok: false, href }, ttlMs: CACHE_TTL_MS };
    }
  } catch (err) {
    reason = errorText(err, token);
  }
  if (!failing) log.warn({ err: reason }, 'host steps list read failed');
  else log.debug({ err: reason }, 'host steps list read failed again');
  failing = true;
  if (lastGood && now - lastGood.at < STALE_MAX_MS) {
    return { body: { ...lastGood.body, stale: true }, ttlMs: FAILURE_TTL_MS };
  }
  return { body: { configured: true, ok: false, href }, ttlMs: FAILURE_TTL_MS };
}

/**
 * The answer: `{ configured: false }` without a Gitea URL and token;
 * `{ configured: true, ok: true, count, items, more, href, stale? }`; or
 * `{ configured: true, ok: false, href }` when the list can't be read or
 * understood (the tile then links to #848). Never throws.
 */
export async function hostActionsAnswer(now = Date.now()) {
  const { url } = sourceUrl('gitea');
  const token = envValue('JAGHELM_GITEA_TOKEN');
  if (!url || !token) return NOT_CONFIGURED;
  const cached = getCached(KEY);
  if (cached) return cached;
  if (!inFlight) {
    inFlight = read(url.replace(/\/+$/, ''), token, now)
      .then(({ body, ttlMs }) => {
        setCache(KEY, body, null, { ttlMs });
        return body;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
