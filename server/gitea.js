/**
 * The Pipeline panel's source: the recent commits on each Gitea repo's
 * default branch (#249).
 *
 * Gitea is read every GITEA_POLL_MS (5 minutes, Jag's decision on #249), not
 * every refresh cycle: a poll is one repos/search request and one commits
 * request per repo (fetchRepoCommits), on the branch repos/search names as the
 * repo's default. Between polls, refreshGitea answers the last poll's result
 * without a request; one poll runs at a time.
 *
 * A failed poll is retried sooner: after GITEA_RETRY_MS (30 s), then twice as
 * long each time, up to GITEA_POLL_MS. Until a poll answers, refreshGitea
 * answers null, a cycle error (the status model's Gitea source failed), and
 * the last list Gitea gave stays cached: /api/gitea/activity serves it with
 * its age (Last-Modified, when Gitea last answered) for two polls after that
 * answer, then 502. A failure is logged when it starts (the first failed
 * poll's line) and when it clears, not at every poll.
 *
 * Without JAGHELM_GITEA_URL (or its old name, GITEA_URL, env.js) no Gitea is
 * set up: nothing is polled, and the payload says so. The token is
 * JAGHELM_GITEA_TOKEN (or GITEA_TOKEN).
 */

import { setCache } from './cache.js';
import { envValue } from './env.js';
import { safeFetch } from './httpClient.js';
import { sourceUrl, sourceUrlSet } from './sourceUrls.js';
import { dedupe } from './util/dedupe.js';
import { createLogger } from './util/logger.js';
import { redactSecrets } from './util/redact.js';

// Its lines keep the module they had in refresh.js.
const log = createLogger('refresh');

/** How often Gitea is polled (#249). */
export const GITEA_POLL_MS = 5 * 60_000;

/** The first retry after a failed poll; each next one waits twice as long, up to GITEA_POLL_MS. */
export const GITEA_RETRY_MS = 30_000;

// The repos one poll reads (one repos/search page), and the commits per repo.
const REPO_LIMIT = 20;
const COMMITS_PER_REPO = 5;

// What /api/gitea/activity answers when no Gitea is set up (#272): the
// dashboard hides its Pipeline panel. Frozen: it is cached and served as is.
export const GITEA_NOT_CONFIGURED = Object.freeze({ configured: false });

/** Whether a Gitea is set up: JAGHELM_GITEA_URL (or GITEA_URL) is set. */
export function giteaConfigured() {
  return sourceUrlSet('gitea');
}

// When the next poll is due (null: at once), what the last one answered (null:
// it failed), and the failed polls in a row, since when.
let dueAt = null;
let lastResult = null;
let failedPolls = 0;
let failingSince = null;

/** Forget the polls so far, so the next refresh polls (tests). */
export function _resetGiteaPoll() {
  dueAt = null;
  lastResult = null;
  failedPolls = 0;
  failingSince = null;
}

// The longest Gitea message the log keeps, in characters.
const GITEA_MESSAGE_MAX = 200;

/** A Gitea answer's body as JSON, or undefined when it is not JSON (a proxy's error page). */
async function giteaBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The repos in a repos/search answer: its `data`, or the answer itself when it
 * is a list. null for anything else, such as the error object Gitea answers a
 * refused request with.
 */
function giteaRepoList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return null;
}

/**
 * `text` fit for the log: the token and any credential in a URL are taken out
 * before it is cut to GITEA_MESSAGE_MAX characters, so the cut leaves no part
 * of one.
 */
function giteaLogText(text, token) {
  const clean = redactSecrets(token ? text.split(token).join('[redacted]') : text);
  return clean.length > GITEA_MESSAGE_MAX ? `${clean.slice(0, GITEA_MESSAGE_MAX)}…` : clean;
}

/**
 * The message in a Gitea error answer, for the log (see giteaLogText): its
 * `message`, or the `error` repos/search reports its own failures in.
 * undefined without a message.
 */
function giteaErrorMessage(body, token) {
  const raw = body?.message ?? body?.error;
  if (typeof raw !== 'string' || raw === '') return undefined;
  return giteaLogText(raw, token);
}

/**
 * An error thrown while polling Gitea, for the log (see giteaLogText). Node's
 * fetch puts the request URL in its message, so a URL with a user and
 * password in it would otherwise reach the log every poll.
 */
function giteaErrorText(err, token) {
  return giteaLogText(String(err?.message || err), token);
}

/**
 * One repo's recent commits on its default branch: the one request a poll
 * makes for each repo. `repo` is { name, fullName, defaultBranch } from
 * repos/search (a repo it names no default branch for is read at Gitea's
 * default); `opts` carries the token header. Throws when the request fails or
 * the answer is not JSON.
 * @param {string} url  the Gitea base URL
 * @param {{ name: string, fullName: string, defaultBranch: string | null }} repo
 * @param {object} opts
 */
export async function fetchRepoCommits(url, repo, opts) {
  const branch = repo.defaultBranch ? `&sha=${encodeURIComponent(repo.defaultBranch)}` : '';
  const res = await safeFetch(
    `${url}/api/v1/repos/${repo.fullName}/commits?limit=${COMMITS_PER_REPO}${branch}`,
    opts
  );
  const data = await res.json();
  const commits = Array.isArray(data)
    ? data.map((c) => ({
        sha: c.sha?.substring(0, 7),
        message: c.commit?.message?.split('\n')[0] || '',
        date: c.commit?.author?.date || '',
        author: c.commit?.author?.name || '',
      }))
    : [];
  return { repo: repo.name, fullName: repo.fullName, commits };
}

/**
 * Recent commits across the Gitea's repos (found with repos/search), polled
 * when due: at the first call, GITEA_POLL_MS after a poll that answered, and
 * sooner after one that failed (see the top). Otherwise the last poll's
 * result, without a request. `now` is the clock (tests).
 *
 * The payload is the repos with recent commits, newest first, or
 * GITEA_NOT_CONFIGURED when no Gitea URL is set, which polls nothing. null
 * when the last poll failed: the last list stays cached for its two polls,
 * then the route answers 502. A repos/search answer without a repo list fails
 * a poll too, with a log line giving the status and what Gitea said (#399),
 * and so does every repo's commits request failing. Some of them failing
 * leaves those repos out. Logged errors are redacted (see giteaLogText).
 *
 * A Gitea URL with a user or password (#419) is refused: the panel is off as
 * without one, nothing is polled or logged (the boot warned it once), and the
 * status model makes the Gitea source off, naming the variable.
 */
export function refreshGitea(now = Date.now()) {
  return dedupe('gitea', () => giteaWhenDue(now));
}

async function giteaWhenDue(now) {
  const { url } = sourceUrl('gitea');
  if (!url) {
    setCache('gitea', GITEA_NOT_CONFIGURED);
    return GITEA_NOT_CONFIGURED;
  }
  if (dueAt !== null && now < dueAt) return lastResult;
  const polled = await pollGitea(url, envValue('JAGHELM_GITEA_TOKEN'));
  if (polled.ok) {
    if (failedPolls > 0) {
      log.info({ failedPolls, downSec: Math.round((now - failingSince) / 1000) }, 'Gitea answers again');
    }
    failedPolls = 0;
    failingSince = null;
    dueAt = now + GITEA_POLL_MS;
    lastResult = polled.result;
    setCache('gitea', lastResult, null, { ttlMs: 2 * GITEA_POLL_MS });
    return lastResult;
  }
  // The first failed poll of a run logs why; the rest of the run at debug.
  if (failedPolls === 0) {
    failingSince = now;
    log.error(polled.fields, polled.msg);
  } else {
    log.debug({ ...polled.fields, failedPolls: failedPolls + 1 }, polled.msg);
  }
  failedPolls += 1;
  dueAt = now + Math.min(GITEA_RETRY_MS * 2 ** (failedPolls - 1), GITEA_POLL_MS);
  lastResult = null;
  return null;
}

/**
 * One poll: `{ ok: true, result }`, or `{ ok: false, fields, msg }`, the line
 * that says why it failed (giteaWhenDue logs it).
 */
async function pollGitea(url, token) {
  try {
    // Header, not ?token= — Gitea logs full request URLs, which would leak it.
    const opts = token ? { headers: { Authorization: `token ${token}` } } : {};

    const reposRes = await safeFetch(`${url}/api/v1/repos/search?limit=${REPO_LIMIT}`, opts);
    const reposData = await giteaBody(reposRes);
    const list = giteaRepoList(reposData);
    if (!list) {
      return {
        ok: false,
        fields: { status: reposRes.status, message: giteaErrorMessage(reposData, token) },
        msg: 'Gitea refresh error: no repo list in the answer',
      };
    }
    const repos = list
      .filter((r) => !r.fork && !r.mirror && !r.archived)
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        defaultBranch: typeof r.default_branch === 'string' && r.default_branch ? r.default_branch : null,
      }));

    if (repos.length === 0) return { ok: true, result: [] };

    const repoCommits = await Promise.allSettled(repos.map((repo) => fetchRepoCommits(url, repo, opts)));

    // A request that threw, or a body that is not JSON. With every repo's
    // failing, an empty list would read as a Gitea with no recent commits.
    const failed = repoCommits.filter((r) => r.status === 'rejected');
    if (failed.length === repos.length) {
      return {
        ok: false,
        fields: { repos: repos.length, err: giteaErrorText(failed[0].reason, token) },
        msg: 'Gitea refresh error: every commits request failed',
      };
    }

    const result = repoCommits
      .filter((r) => r.status === 'fulfilled' && r.value.commits.length > 0)
      .map((r) => r.value)
      .sort((a, b) => {
        const aDate = a.commits[0]?.date || '';
        const bDate = b.commits[0]?.date || '';
        return new Date(bDate) - new Date(aDate);
      });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, fields: { err: giteaErrorText(err, token) }, msg: 'Gitea refresh error' };
  }
}
