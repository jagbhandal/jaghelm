/**
 * Why a node has no `up` reading to go by (#470, #476, #477): the one place
 * that decides it. Discovery (discovery.js checkTargets) asks whyUpMissing()
 * for each node whose `up` is 0, or that has no `up` series and no metric,
 * and acts on the verdict's row of UP_MISSING; the status model words the
 * node from the same row (judgeNode), and push pages from the model. So the
 * screens, the Prometheus source's health and push can't disagree.
 *
 * Prometheus writes an `up` sample on every scrape, 0 included, so a node
 * with a target and no `up` series is never the host's fault. A node's
 * targets are those in Prometheus's active target list
 * (`/api/v1/targets?state=active`) with its `node` label.
 */
import { NOT_SCRAPED } from './rules.js';

/** The verdicts. */
export const WHY = Object.freeze({
  /** `up` 0, every target of the node scraped and down (or none of its own): the host is down. */
  SCRAPED_AND_DOWN: 'scraped-and-down',
  /** No `up` series and no target of its own, while the list names other nodes: gone from Prometheus. */
  NO_TARGET: 'no-target',
  /** No `up` series, and the list names none of the nodes (a federation or remote-write backend, #477). */
  NO_TARGETS_AT_ALL: 'no-targets-at-all',
  /** A target of the node waiting for its first scrape, within WAIT_INTERVALS of its intervals. */
  NOT_SCRAPED_YET: 'not-scraped-yet',
  /** A target of the node waiting for its first scrape for WAIT_INTERVALS of its intervals or more (#476). */
  NOT_SCRAPED_TOO_LONG: 'not-scraped-too-long',
  /** `up` 0, and a target answered a scrape since the query (or the series came by the second ask). */
  ANSWERED_SINCE: 'answered-since',
  /** No `up` series though a target of the node was scraped: Prometheus stores nothing (a full disk). */
  STORED_NOTHING: 'stored-nothing',
  /** No `up` series, and the target list could not be read. */
  TARGETS_UNREAD: 'targets-unread',
});

/**
 * What each verdict means:
 * - `unread`: the node is No signal, every read in its `failedReads`; false
 *   leaves it as `up` says (unreachable: push pages host_unreachable).
 * - `failing`: the Prometheus source fails, with the node's problem as its
 *   error, while it answers: only the node is held, nothing else Prometheus
 *   feeds (one source_down after 2 cycles, never a page per host).
 * - `passing`: it ends by itself within about a scrape interval, so presence
 *   breadcrumbs wait for every node meanwhile; a lasting one holds back only
 *   the node's own (refresh.js).
 * - `reason`: the model's reason for the node, and for the containers it ran
 *   (null: the node is judged by `up`).
 */
export const UP_MISSING = Object.freeze({
  [WHY.SCRAPED_AND_DOWN]: { unread: false, failing: false, passing: false, reason: null },
  [WHY.NO_TARGET]: { unread: false, failing: false, passing: false, reason: null },
  [WHY.NO_TARGETS_AT_ALL]: {
    unread: true,
    failing: true,
    passing: false,
    reason: 'No data: no up series, and no target in Prometheus',
  },
  [WHY.NOT_SCRAPED_YET]: { unread: true, failing: false, passing: true, reason: NOT_SCRAPED },
  [WHY.NOT_SCRAPED_TOO_LONG]: {
    unread: true,
    failing: true,
    passing: false,
    reason: 'No data: still not scraped by Prometheus',
  },
  [WHY.ANSWERED_SINCE]: { unread: true, failing: false, passing: true, reason: NOT_SCRAPED },
  [WHY.STORED_NOTHING]: {
    unread: true,
    failing: true,
    passing: false,
    reason: 'No data: Prometheus stored no up series',
  },
  [WHY.TARGETS_UNREAD]: {
    unread: true,
    failing: true,
    passing: false,
    reason: "No data: Prometheus's target list unreadable",
  },
});

/** How many of a target's scrape intervals it may wait for its first scrape before it is a problem (#476). */
export const WAIT_INTERVALS = 3;

/** A target's scrape interval when the list doesn't give one: Prometheus's default. */
export const DEFAULT_SCRAPE_INTERVAL_MS = 60_000;

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000 };

/** A Prometheus duration ("15s", "1m30s", "500ms") in ms, or null when it isn't one or is 0. */
export function durationMs(text) {
  if (typeof text !== 'string' || !/^(?:\d+(?:ms|s|m|h|d|w|y))+$/.test(text)) return null;
  let ms = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)(ms|s|m|h|d|w|y)/g)) ms += Number(n) * UNIT_MS[unit];
  return ms > 0 ? ms : null;
}

/** How long target `t` may wait for its first scrape: WAIT_INTERVALS of its `scrapeInterval`. */
export function waitLimitMs(t) {
  return WAIT_INTERVALS * (durationMs(t?.scrapeInterval) ?? DEFAULT_SCRAPE_INTERVAL_MS);
}

/** Whether Prometheus has yet to scrape `t`: health "unknown", or no last scrape. */
export function notScrapedYet(t) {
  return t?.health === 'unknown' || !(Date.parse(t?.lastScrape) > 0);
}

/**
 * When target `t`, waiting for its first scrape, began waiting, as far as the
 * list can say: its last scrape when it has one (scraped once, then reset to
 * "unknown"), else null, and the caller counts from the first cycle that saw
 * it waiting (targetWaits.js).
 */
export function listedWaitSince(t) {
  const at = Date.parse(t?.lastScrape);
  return at > 0 ? at : null;
}

/**
 * Why node's `up` is missing or 0, and so what it reads as (UP_MISSING).
 *
 * @param {{
 *   up: null|false,
 *   targets: Array<any>|null,
 *   namesNodes: boolean,
 *   now: number,
 *   sinceOf: (t: any) => number|null,
 * }} input
 *   up: null for no `up` series (and no metric), false for `up` 0;
 *   targets: the node's own targets, or null when the list couldn't be read;
 *   namesNodes: whether the list names any of the nodes JagHelm reads;
 *   sinceOf: when a target waiting for its first scrape began waiting (null: now)
 * @returns {{ why: string, overdue: Array<any> }} the verdict, and the node's
 *   targets past their wait (NOT_SCRAPED_TOO_LONG's, to name them)
 *
 * In order: no list (`up` 0 stands); no target of its own (`up` 0 stands; no
 * `up` series is the host gone, unless the list names no node at all); a
 * target waiting past its limit; no `up` series with every target waiting
 * (not scraped yet) or with one scraped (stored nothing); `up` 0 with a target
 * waiting (not scraped yet) or one that answered since; else down.
 */
export function whyUpMissing({ up, targets, namesNodes, now, sinceOf }) {
  const verdict = (why, overdue = []) => ({ why, overdue });
  if (targets === null) return verdict(up === false ? WHY.SCRAPED_AND_DOWN : WHY.TARGETS_UNREAD);
  if (targets.length === 0) {
    if (up === false) return verdict(WHY.SCRAPED_AND_DOWN);
    return verdict(namesNodes ? WHY.NO_TARGET : WHY.NO_TARGETS_AT_ALL);
  }
  const waiting = targets.filter(notScrapedYet);
  const overdue = waiting.filter((t) => now - (sinceOf(t) ?? now) >= waitLimitMs(t));
  if (overdue.length > 0) return verdict(WHY.NOT_SCRAPED_TOO_LONG, overdue);
  if (up !== false) return verdict(waiting.length === targets.length ? WHY.NOT_SCRAPED_YET : WHY.STORED_NOTHING);
  if (waiting.length > 0) return verdict(WHY.NOT_SCRAPED_YET);
  if (targets.some((t) => t?.health === 'up')) return verdict(WHY.ANSWERED_SINCE);
  return verdict(WHY.SCRAPED_AND_DOWN);
}

/** "vm103:9100 (vm103)": a target as a source's error names it. */
export function targetName(t) {
  const node = t?.labels?.node;
  const what = t?.labels?.instance || t?.scrapeUrl || t?.labels?.job || 'a target';
  return node && node !== what ? `${what} (${node})` : String(what);
}
