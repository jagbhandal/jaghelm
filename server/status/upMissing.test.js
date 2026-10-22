/**
 * Why a node's `up` is missing or 0 (#470, #476, #477): the one decision
 * discovery acts on and the status model words, as a table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SCRAPE_INTERVAL_MS,
  UP_MISSING,
  WAIT_INTERVALS,
  WHY,
  durationMs,
  listedWaitSince,
  notScrapedYet,
  targetName,
  waitLimitMs,
  whyUpMissing,
} from './upMissing.js';
import { NOT_SCRAPED } from './rules.js';

const NOW = 1_782_345_600_000;
const ZERO_TIME = '0001-01-01T00:00:00Z';

/** A target of vm103 as /api/v1/targets lists it, scraped every 30 s. */
const t = (health, { job = 'node', port = 9100, lastScrape, scrapeInterval = '30s' } = {}) => ({
  labels: { instance: `vm103:${port}`, job, node: 'vm103' },
  scrapePool: job,
  scrapeUrl: `http://vm103:${port}/metrics`,
  health,
  lastScrape: lastScrape ?? (health === 'unknown' ? ZERO_TIME : new Date(NOW - 5_000).toISOString()),
  scrapeInterval,
});
const waiting = t('unknown');
const cadvisorDown = t('down', { job: 'cadvisor', port: 8080 });
const cadvisorUp = t('up', { job: 'cadvisor', port: 8080 });

// Every reason, and what leads to it. `waited` is how long the waiting
// targets have waited (sinceOf); the limit is 3 × 30 s.
const CASES = [
  ['up 0, every target scraped and down', { up: false, targets: [t('down'), cadvisorDown] }, WHY.SCRAPED_AND_DOWN],
  ['up 0, no target of its own', { up: false, targets: [] }, WHY.SCRAPED_AND_DOWN],
  ['up 0, no target of its own, the list naming no node (federation)', { up: false, targets: [], namesNodes: false }, WHY.SCRAPED_AND_DOWN],
  ['up 0, the target list unread', { up: false, targets: null }, WHY.SCRAPED_AND_DOWN],
  ['no up series, no target of its own, others listed', { up: null, targets: [] }, WHY.NO_TARGET],
  ['no up series, an empty list', { up: null, targets: [], namesNodes: false }, WHY.NO_TARGETS_AT_ALL],
  ['no up series, every target waiting, inside the limit', { up: null, targets: [waiting], waited: 60_000 }, WHY.NOT_SCRAPED_YET],
  ['no up series, every target waiting, at the limit', { up: null, targets: [waiting], waited: 90_000 }, WHY.NOT_SCRAPED_TOO_LONG],
  ['no up series, one target waiting past the limit, one scraped', { up: null, targets: [waiting, cadvisorUp], waited: 120_000 }, WHY.NOT_SCRAPED_TOO_LONG],
  ['up 0, a target waiting, inside the limit', { up: false, targets: [cadvisorDown, waiting], waited: 30_000 }, WHY.NOT_SCRAPED_YET],
  ['up 0, a target waiting past the limit', { up: false, targets: [cadvisorDown, waiting], waited: 600_000 }, WHY.NOT_SCRAPED_TOO_LONG],
  ['up 0, a target that answered since the query', { up: false, targets: [cadvisorUp, t('down')] }, WHY.ANSWERED_SINCE],
  ['no up series, a target scraped', { up: null, targets: [t('up')] }, WHY.STORED_NOTHING],
  ['no up series, one target scraped, one waiting inside the limit', { up: null, targets: [cadvisorUp, waiting], waited: 0 }, WHY.STORED_NOTHING],
  ['no up series, the target list unread', { up: null, targets: null }, WHY.TARGETS_UNREAD],
];

test('#476 #477: whyUpMissing decides every reason, as the table says', () => {
  for (const [name, { up, targets, namesNodes = true, waited = 0 }, why] of CASES) {
    const verdict = whyUpMissing({ up, targets, namesNodes, now: NOW, sinceOf: () => NOW - waited });
    assert.equal(verdict.why, why, name);
  }
  const reached = new Set(CASES.map(([, , why]) => why));
  assert.deepEqual([...reached].sort(), Object.values(WHY).sort(), 'every reason has a case');
});

test('#476: a waiting target with no start of its own counts from now: inside its limit', () => {
  const verdict = whyUpMissing({ up: null, targets: [waiting], namesNodes: true, now: NOW, sinceOf: () => null });
  assert.equal(verdict.why, WHY.NOT_SCRAPED_YET);
});

test('#476: the targets past their wait are the verdict\'s, to name them; only those', () => {
  const late = t('unknown', { job: 'node', scrapeInterval: '10s' }); // limit 30 s
  const slow = t('unknown', { job: 'cadvisor', port: 8080, scrapeInterval: '1m' }); // limit 3 min
  const verdict = whyUpMissing({ up: null, targets: [late, slow], namesNodes: true, now: NOW, sinceOf: () => NOW - 60_000 });
  assert.equal(verdict.why, WHY.NOT_SCRAPED_TOO_LONG);
  assert.deepEqual(verdict.overdue, [late]);
  for (const [, { up, targets, namesNodes = true }, why] of CASES) {
    if (why === WHY.NOT_SCRAPED_TOO_LONG) continue;
    assert.deepEqual(whyUpMissing({ up, targets, namesNodes, now: NOW, sinceOf: () => NOW }).overdue, [], why);
  }
});

test('#476 #477: each reason\'s row: unread, Prometheus failing, passing, and the model\'s words', () => {
  const rows = Object.fromEntries(
    Object.entries(UP_MISSING).map(([why, r]) => [why, [r.unread, r.failing, r.passing, r.reason]])
  );
  assert.deepEqual(rows, {
    [WHY.SCRAPED_AND_DOWN]: [false, false, false, null],
    [WHY.NO_TARGET]: [false, false, false, null],
    [WHY.NO_TARGETS_AT_ALL]: [true, true, false, 'No data: no up series, and no target in Prometheus'],
    [WHY.NOT_SCRAPED_YET]: [true, false, true, NOT_SCRAPED],
    [WHY.NOT_SCRAPED_TOO_LONG]: [true, true, false, 'No data: still not scraped by Prometheus'],
    [WHY.ANSWERED_SINCE]: [true, false, true, NOT_SCRAPED],
    [WHY.STORED_NOTHING]: [true, true, false, 'No data: Prometheus stored no up series'],
    [WHY.TARGETS_UNREAD]: [true, true, false, "No data: Prometheus's target list unreadable"],
  });
});

test('#476: a scrape interval is read as Prometheus writes durations', () => {
  for (const [text, ms] of [
    ['15s', 15_000],
    ['30s', 30_000],
    ['1m', 60_000],
    ['1m30s', 90_000],
    ['500ms', 500],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ]) {
    assert.equal(durationMs(text), ms, text);
  }
  for (const text of ['', '0s', '15', 's', '1.5m', '15 s', 'soon', undefined, 15, null]) {
    assert.equal(durationMs(text), null, String(text));
  }
});

test('#476: a target may wait 3 of its scrape intervals, Prometheus\'s default 1 m when the list gives none', () => {
  assert.equal(WAIT_INTERVALS, 3);
  assert.equal(waitLimitMs(t('unknown', { scrapeInterval: '30s' })), 90_000);
  assert.equal(waitLimitMs(t('unknown', { scrapeInterval: '5m' })), 900_000);
  assert.equal(waitLimitMs({ ...t('unknown'), scrapeInterval: undefined }), 3 * DEFAULT_SCRAPE_INTERVAL_MS);
  assert.equal(waitLimitMs({ ...t('unknown'), scrapeInterval: 'never' }), 180_000);
});

test('#476: waiting for a first scrape, and since when the list can say', () => {
  assert.equal(notScrapedYet(t('unknown')), true);
  assert.equal(notScrapedYet({ ...t('up'), lastScrape: undefined }), true, 'no last scrape');
  assert.equal(notScrapedYet({ ...t('up'), lastScrape: ZERO_TIME }), true, "Prometheus's zero time");
  assert.equal(notScrapedYet(t('down')), false);
  assert.equal(listedWaitSince(t('unknown')), null, 'never scraped: the list cannot say');
  const at = '2026-10-22T10:00:00Z';
  assert.equal(listedWaitSince(t('unknown', { lastScrape: at })), Date.parse(at), 'scraped once, then unknown');
});

test('#476: a target is named by its instance and node', () => {
  assert.equal(targetName(t('unknown')), 'vm103:9100 (vm103)');
  assert.equal(targetName({ scrapeUrl: 'http://10.0.0.5:9100/metrics', labels: { node: 'pi' } }), 'http://10.0.0.5:9100/metrics (pi)');
  assert.equal(targetName({ labels: { instance: 'nas' , node: 'nas' } }), 'nas');
  assert.equal(targetName({}), 'a target');
});
