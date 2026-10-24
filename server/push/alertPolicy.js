// @ts-check
/**
 * What the outbox's sender asks before it sends (#669): given the queued
 * entries, which go out now, as one push or alone, which wait, which are
 * silenced. The queue, its collapsing of a page with its unsent recovery, its
 * cap, its retries and its persistence are all as they were; this only
 * decides, round by round, how the queued pages are put to the phones.
 *
 * `plan(entries)` returns units in queue order. A unit is one push:
 *
 *   single   one entry, sent as it is (a known cause appended to its body)
 *   group    entries queued inside one burst window (alertRules
 *            groupWindowMs from the first), one summary push; ready once the
 *            window since the FIRST has passed, so no alert waits longer than
 *            the window, and a lone one is sent as itself
 *   digest   the entries held through the quiet hours, one summary, ready
 *            when the quiet hours end
 *   drop     an entry Snooze or Ack silenced: finished without a send
 *
 * A unit that is not `ready` stays in the outbox until `until` (ms); the
 * sender sleeps to the soonest one. Nothing is decided from memory the file
 * doesn't keep: an entry's `queuedAt` is persisted, so after a restart a
 * burst's window and a night's hold are worked out again the same.
 *
 * Never grouped, held or silenced: a test push, one for a single phone, and
 * anything that is not a page or a recovery (an Arcane update, the status
 * check's own push): those are `single` and ready.
 */
import { alertKind } from './dispatch.js';
import { causeFor, quietAt, summarize } from './alertRules.js';
import { buildWebPayload } from './webPush.js';

/**
 * @typedef {{ event: any, queuedAt: number, sent?: boolean }} Entry
 * @typedef {{ kind: 'single' | 'group' | 'digest' | 'drop', entries: Entry[], ready: boolean, until: number, reason?: 'snooze' | 'ack' }} Unit
 */

/**
 * @param {object} deps
 * @param {() => import('./alertRules.js').AlertRules} deps.rules  the rules now in force (read from the config each call)
 * @param {ReturnType<typeof import('./alertState.js').createAlertState>} deps.state
 * @param {() => number} [deps.now]
 */
export function createAlertPolicy({ rules, state, now = () => Date.now() }) {
  /** The key Snooze and Ack use for an event: its notification's tag. */
  const tagOf = (/** @type {any} */ event) => buildWebPayload(event).tag;
  const plain = (/** @type {Entry} */ entry) =>
    alertKind(entry.event) === 'other' || typeof entry.event.device === 'string';

  /**
   * @param {Entry[]} entries  the outbox, oldest first
   * @returns {Unit[]}
   */
  function plan(entries) {
    const at = now();
    const r = rules();
    /** @type {Array<Unit | null>} */
    const units = [];
    /** @type {Map<number, Unit>} quiet-hours digests by when the quiet hours end */
    const digests = new Map();
    /** @type {{ page: Unit | null, recovery: Unit | null }} the burst each direction is collecting */
    const open = { page: null, recovery: null };

    for (const entry of entries) {
      if (plain(entry)) {
        units.push({ kind: 'single', entries: [entry], ready: true, until: at });
        continue;
      }
      const kind = /** @type {'page' | 'recovery'} */ (alertKind(entry.event));
      const hushed = state.suppression(tagOf(entry.event), kind === 'recovery');
      if (hushed) {
        units.push({ kind: 'drop', entries: [entry], ready: true, until: at, reason: hushed });
        continue;
      }
      // Held through the quiet hours: a page that is not critical (all of them
      // in silent mode), and every recovery.
      const q = quietAt(r, entry.queuedAt);
      if (
        q.quiet &&
        !(r.quiet.mode === 'critical' && kind === 'page' && entry.event.severity === 'critical')
      ) {
        let digest = digests.get(q.endsAt);
        if (!digest) {
          digest = { kind: 'digest', entries: [], ready: at >= q.endsAt, until: q.endsAt };
          digests.set(q.endsAt, digest);
          units.push(digest);
        }
        digest.entries.push(entry);
        continue;
      }
      if (r.groupWindowMs <= 0) {
        units.push({ kind: 'single', entries: [entry], ready: true, until: at });
        continue;
      }
      let burst = open[kind];
      if (!burst || entry.queuedAt - burst.entries[0].queuedAt > r.groupWindowMs) {
        const until = entry.queuedAt + r.groupWindowMs;
        burst = { kind: 'group', entries: [], ready: at >= until, until };
        open[kind] = burst;
        units.push(burst);
      }
      burst.entries.push(entry);
    }
    // A burst or a digest of one is that alert, sent as itself.
    return /** @type {Unit[]} */ (units).map((u) =>
      (u.kind === 'group' || u.kind === 'digest') && u.entries.length === 1
        ? { ...u, kind: 'single' }
        : u
    );
  }

  /** The event to send for one entry: itself, with its known cause for the body. */
  function decorate(/** @type {any} */ event) {
    const cause = causeFor(event, rules().causes);
    return cause ? { ...event, cause } : event;
  }

  return {
    plan,
    tagOf,
    decorate,
    /**
     * The one event for a unit's entries that are going to a phone: the
     * entry's own for one, else a summary push (never sent ahead to phones
     * the outbox hasn't asked for: `noAhead`).
     * @param {Entry[]} entries
     * @param {'group' | 'digest'} kind
     */
    eventFor(entries, kind) {
      if (entries.length === 1) return decorate(entries[0].event);
      const events = entries.map((e) => e.event);
      const summary = summarize(events, kind, { tagOf, cause: (e) => causeFor(e, rules().causes) });
      return {
        ...summary,
        noAhead: true,
        actionable: entries.some((e) => alertKind(e.event) === 'page'),
      };
    },
    /** Note a handled entry for Ack (a page opens its incident, a recovery ends it). */
    observe(/** @type {Entry} */ entry) {
      const kind = alertKind(entry.event);
      if (kind === 'other') return;
      state.observe(tagOf(entry.event), kind === 'recovery');
    },
    flush: () => state.flush(),
    state,
    rules,
  };
}
