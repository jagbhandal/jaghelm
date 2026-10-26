/**
 * The Pipeline panel's source: each Gitea repo's recent commits, with the CI
 * result, branch and short sha of each (#249, #532).
 *
 * Gitea is read every GITEA_POLL_MS (5 minutes, Jag's decision on #249), not
 * every refresh cycle: a poll is one repos/search request and one request per
 * repo (fetchRepoPipeline), however many rows it gives. A repo with Actions is
 * read through its latest push runs: a row per commit and branch they ran on,
 * with the CI result of its runs (judgeCiRuns, the status rules' one table).
 * A repo with Actions off, or with no run (Actions on but no workflow, or no
 * Actions API: a 404), is read through its commits on the branch repos/search
 * names as its default (fetchRepoCommits), with no CI result: no lamp, never
 * a failure. A repo with Actions on whose runs answer had no run costs that
 * poll a second request, its commits; then it is asked for its commits alone
 * for NO_RUNS_RECHECK_MS (an hour) before its runs are asked for again. Gitea
 * answers both without an ETag, so nothing is asked conditionally.
 * Between polls, refreshGitea answers the last poll's result without a
 * request; one poll runs at a time.
 *
 * A failed poll is retried sooner: after GITEA_RETRY_MS (30 s), then twice as
 * long each time, up to GITEA_POLL_MS. Until a poll answers, refreshGitea
 * answers null, a cycle error (the status model's Gitea source failed), and
 * the last list Gitea gave stays cached: /api/gitea/activity serves it with
 * its age (Last-Modified, when Gitea last answered) for two polls after that
 * answer, then 502. A failure is logged when it starts (the first failed
 * poll's line), when it fails for another reason, and when it clears, not at
 * every poll. Why it fails is kept (giteaFailure) for the status model, which
 * says it in words (failureWords.js, #605).
 *
 * Without JAGHELM_GITEA_URL (or its old name, GITEA_URL, env.js) no Gitea is
 * set up: nothing is polled, and the payload says so. The token is
 * JAGHELM_GITEA_TOKEN (or GITEA_TOKEN).
 */

import { setCache } from './cache.js';
import { envValue } from './env.js';
import { safeFetch } from './httpClient.js';
import { sourceUrl, sourceUrlSet } from './sourceUrls.js';
import { judgeCiRuns } from './status/rules.js';
import { failureSentence, readFailure } from './failureWords.js';
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

// The push runs one poll reads per repo: a push can start a few workflows, a
// run each, so more runs than commits. Each run is about 5 KB of JSON.
const RUNS_PER_REPO = 10;

// How long a repo whose runs answer had no run is read through its commits
// alone, before its runs are asked for again (#532). An hour, not until the
// next restart: a repo given its first workflow shows its lamps within the
// hour, for one more request an hour while it has none.
const NO_RUNS_RECHECK_MS = 60 * 60_000;

// What /api/gitea/activity answers when no Gitea is set up (#272): the
// dashboard hides its Pipeline panel. Frozen: it is cached and served as is.
export const GITEA_NOT_CONFIGURED = Object.freeze({ configured: false });

/**
 * Why the last poll failed, while polls fail: its cause (`{ cause, status? }`,
 * failureWords.js), which the status model says in words (#605). null while
 * Gitea answers, before a poll, or with no Gitea set up.
 */
export function giteaFailure() {
  return lastFailure;
}

/** Whether a Gitea is set up: JAGHELM_GITEA_URL (or GITEA_URL) is set. */
export function giteaConfigured() {
  return sourceUrlSet('gitea');
}

// When the next poll is due (null: at once), what the last one answered (null:
// it failed), and the failed polls in a row, since when, and why (its cause,
// failureWords.js readFailure).
let dueAt = null;
let lastResult = null;
let failedPolls = 0;
let failingSince = null;
let lastFailure = null;
// The repos whose runs answer had no run: full name -> until when their
// commits alone are asked for.
const noRunsUntil = new Map();

/** Forget the polls so far, so the next refresh polls (tests). */
export function _resetGiteaPoll() {
  dueAt = null;
  lastResult = null;
  failedPolls = 0;
  failingSince = null;
  lastFailure = null;
  noRunsUntil.clear();
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
 * One repo's recent commits on its default branch, with no CI result: what a
 * repo without Actions shows. `repo` is { name, fullName, defaultBranch } from
 * repos/search (a repo it names no default branch for is read at Gitea's
 * default, and its rows name no branch); `opts` carries the token header.
 * Throws when the request fails, Gitea answers non-2xx (the error carries its
 * `status`) or the answer is not JSON.
 * @param {string} url  the Gitea base URL
 * @param {{ name: string, fullName: string, defaultBranch: string | null }} repo
 * @param {object} opts
 */
export async function fetchRepoCommits(url, repo, opts) {
  const branch = repo.defaultBranch ? `&sha=${encodeURIComponent(repo.defaultBranch)}` : '';
  // No diff stats, files or signature checks: nothing here shows them, and
  // they made the answer half again as big and three times as slow (#532).
  const res = await safeFetch(
    `${url}/api/v1/repos/${repo.fullName}/commits?limit=${COMMITS_PER_REPO}${branch}` +
      '&stat=false&verification=false&files=false',
    opts
  );
  // A 5xx's JSON error object would read as a repo with no commits, and every
  // repo's would blank the panel; fail the request, so the poll's last list stays (#341).
  if (!res.ok) {
    throw Object.assign(new Error(`Gitea answered HTTP ${res.status} to the commits of ${repo.fullName}`), {
      status: res.status,
    });
  }
  const data = await res.json();
  const commits = Array.isArray(data)
    ? data.map((c) => ({
        sha: c.sha?.substring(0, 7),
        message: c.commit?.message?.split('\n')[0] || '',
        date: c.commit?.author?.date || '',
        author: c.commit?.author?.name || '',
        ref: repo.defaultBranch,
        ci: null,
      }))
    : [];
  return { repo: repo.name, fullName: repo.fullName, commits };
}

/**
 * The rows a run list gives: a row per commit and branch the runs ran on,
 * newest first, at most COMMITS_PER_REPO, each with the CI result of the
 * newest run of each workflow on it (a run again of a failed deploy counts,
 * not the failure). The row is the newest run's: its title (the commit's
 * first line, for a push), when it was started and who by.
 *
 * A full page (RUNS_PER_REPO runs) may hold only some of its oldest commit's
 * runs, the rest on the next page: a push of four workflows, two of them on
 * the page and passed, would read as passed whatever the other two did. So a
 * full page leaves out the commit its oldest run is on, unless it is the only
 * one.
 */
function runCommits(runs) {
  const newestFirst = runs
    .filter((run) => typeof run?.head_sha === 'string' && run.head_sha !== '')
    .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  const keyOf = (run) => {
    const ref = typeof run.head_branch === 'string' && run.head_branch ? run.head_branch : null;
    return [`${run.head_sha} ${ref ?? ''}`, ref];
  };
  const commits = new Map();
  for (const run of newestFirst) {
    const [key, ref] = keyOf(run);
    let commit = commits.get(key);
    if (!commit) {
      commit = { newest: run, ref, workflows: new Map() };
      commits.set(key, commit);
    }
    const workflow = run.path ?? run.workflow_id ?? run.id;
    if (!commit.workflows.has(workflow)) commit.workflows.set(workflow, run);
  }
  if (runs.length >= RUNS_PER_REPO && commits.size > 1) {
    commits.delete(keyOf(newestFirst.at(-1))[0]);
  }
  return [...commits.values()].slice(0, COMMITS_PER_REPO).map(({ newest, ref, workflows }) => ({
    sha: newest.head_sha.substring(0, 7),
    message: String(newest.display_title ?? '').split('\n')[0],
    date: typeof newest.created_at === 'string' ? newest.created_at : '',
    author: newest.actor?.full_name || newest.actor?.login || '',
    ref,
    ci: judgeCiRuns([...workflows.values()]),
  }));
}

/**
 * One repo's rows, from one request (see the top): its latest push runs when
 * it has Actions, else its commits (fetchRepoCommits). A runs answer that is
 * no run list, or an empty one, falls back to the commits: CI is extra, so a
 * repo that has none reads as before; and its commits alone are asked for
 * until NO_RUNS_RECHECK_MS has passed. `repo.hasActions` is repos/search's
 * `has_actions` (false: Actions off, so no runs request); `opts` carries the
 * token header; `now` is the clock. Throws when a request fails or the
 * commits are not JSON.
 * @param {string} url  the Gitea base URL
 * @param {{ name: string, fullName: string, defaultBranch: string | null, hasActions: boolean }} repo
 * @param {object} opts
 * @param {number} [now]
 */
export async function fetchRepoPipeline(url, repo, opts, now = Date.now()) {
  if (repo.hasActions && !(noRunsUntil.get(repo.fullName) > now)) {
    const res = await safeFetch(
      `${url}/api/v1/repos/${repo.fullName}/actions/runs?event=push&limit=${RUNS_PER_REPO}`,
      opts
    );
    const runs = res.ok ? (await giteaBody(res))?.workflow_runs : undefined;
    if (Array.isArray(runs) && runs.length > 0) {
      noRunsUntil.delete(repo.fullName);
      return { repo: repo.name, fullName: repo.fullName, commits: runCommits(runs) };
    }
    noRunsUntil.set(repo.fullName, now + NO_RUNS_RECHECK_MS);
  }
  return fetchRepoCommits(url, repo, opts);
}

/**
 * Recent commits across the Gitea's repos (found with repos/search), polled
 * when due: at the first call, GITEA_POLL_MS after a poll that answered, and
 * sooner after one that failed (see the top). Otherwise the last poll's
 * result, without a request. `now` is the clock (tests).
 *
 * The payload is the repos with recent commits, newest first, each `{ repo,
 * fullName, commits: [{ sha, message, date, author, ref, ci }] }`: `ref` the
 * branch (null when Gitea names none), `ci` the commit's CI result `{ state,
 * word }` or null without one (#532). GITEA_NOT_CONFIGURED when no Gitea URL
 * is set, which polls nothing. null when the last poll failed: the last list
 * stays cached for its two polls, then the route answers 502. A repos/search
 * answer without a repo list fails a poll too, with a log line giving the
 * status and what Gitea said (#399), and so does every repo's request
 * failing. Some of them failing leaves those repos out. Logged errors are
 * redacted (see giteaLogText).
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
    lastFailure = null;
    setCache('gitea', GITEA_NOT_CONFIGURED);
    return GITEA_NOT_CONFIGURED;
  }
  if (dueAt !== null && now < dueAt) return lastResult;
  const polled = await pollGitea(url, envValue('JAGHELM_GITEA_TOKEN'), now);
  if (polled.ok) {
    if (failedPolls > 0) {
      log.info({ failedPolls, downSec: Math.round((now - failingSince) / 1000) }, 'Gitea answers again');
    }
    failedPolls = 0;
    failingSince = null;
    lastFailure = null;
    dueAt = now + GITEA_POLL_MS;
    lastResult = polled.result;
    setCache('gitea', lastResult, null, { ttlMs: 2 * GITEA_POLL_MS });
    return lastResult;
  }
  // The first failed poll of a run logs why, and so does one failing for
  // another reason (its words change); the rest of the run at debug.
  const words = failureSentence('gitea', polled.failure);
  const changed = lastFailure !== null && words !== failureSentence('gitea', lastFailure);
  if (failedPolls === 0 || changed) {
    if (failedPolls === 0) failingSince = now;
    log.error({ ...polled.fields, words }, polled.msg);
  } else {
    log.debug({ ...polled.fields, failedPolls: failedPolls + 1 }, polled.msg);
  }
  lastFailure = polled.failure;
  failedPolls += 1;
  dueAt = now + Math.min(GITEA_RETRY_MS * 2 ** (failedPolls - 1), GITEA_POLL_MS);
  lastResult = null;
  return null;
}

/**
 * One poll: `{ ok: true, result }`, or `{ ok: false, fields, msg, failure }`,
 * the line that says why it failed (giteaWhenDue logs it) and its cause
 * (failureWords.js readFailure).
 */
async function pollGitea(url, token, now) {
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
        failure: reposRes.ok ? { cause: 'unreadable' } : readFailure({ status: reposRes.status }),
      };
    }
    const repos = list
      .filter((r) => !r.fork && !r.mirror && !r.archived && r.empty !== true)
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        defaultBranch: typeof r.default_branch === 'string' && r.default_branch ? r.default_branch : null,
        // Not given (an older Gitea): ask for runs, and fall back on a 404.
        hasActions: r.has_actions !== false,
      }));

    if (repos.length === 0) return { ok: true, result: [] };

    const repoCommits = await Promise.allSettled(
      repos.map((repo) => fetchRepoPipeline(url, repo, opts, now))
    );

    // A request that threw, or commits that are not JSON. With every repo's
    // failing, an empty list would read as a Gitea with no recent commits.
    const failed = repoCommits.filter((r) => r.status === 'rejected');
    if (failed.length === repos.length) {
      return {
        ok: false,
        fields: { repos: repos.length, err: giteaErrorText(failed[0].reason, token) },
        msg: 'Gitea refresh error: every repo request failed',
        failure: readFailure(failed[0].reason),
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
    return { ok: false, fields: { err: giteaErrorText(err, token) }, msg: 'Gitea refresh error', failure: readFailure(err) };
  }
}
