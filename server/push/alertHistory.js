/**
 * The alert history (#267): every event the push differ makes, whether or not
 * push is set up, kept 30 days and served newest first by GET /api/events
 * (routes/events.js). Before it, the server worked out each change and kept
 * none: nothing said what happened while nobody was looking.
 *
 * It lives in memory and in the push snapshot file, under `history`, written
 * in the one atomic write that advances the snapshot and queues the cycle's
 * pushes (push/dispatch.js createPushSnapshot). So a crash before that write
 * leaves the last snapshot, and the restart diffs the change again and records
 * it once; a crash after it leaves the record with the snapshot that made it,
 * and nothing is diffed again. No event is lost or recorded twice, with no
 * second file to keep in step and nothing to dedupe on load.
 *
 * Each record:
 *   id        a decimal string, one more than the last given: never given
 *             twice, as the file keeps the last one (`lastId`) even when every
 *             event in it has aged out. The cursor of a page is one.
 *   at        when the cycle saw the change (ISO 8601)
 *   type      the differ's (service_down, host_threshold, …)
 *   severity  critical | warning | info
 *   entity    the status model's id of what it is about, the one #309's URLs
 *             and a push's tap open (push/androidPayload.js entityOf); null for
 *             the status check's own event
 *   title, body, reason   the push's words: the model's name and reason
 *   node, key the event's node and its key within its type (a push's `id`)
 *   push      what push did with it, { state, phones, suppressed }:
 *               off        push wasn't set up (no FCM credentials)
 *               queued     waiting to be sent
 *               sent       `phones` phones got it (`suppressed` had it
 *                          switched off in their settings)
 *               suppressed no phone got it, and a phone's settings turned it off
 *               unsent     no phone got it: none registered, or each send
 *                          failed for good (a dead token, a refused payload)
 *               dropped    the outbox let it go before any phone got it: its
 *                          problem cleared first, or the outbox was full
 *
 * Bounded twice: an event older than HISTORY_MAX_AGE_MS is never served and
 * leaves the file at its next write, and past HISTORY_CAP the oldest go first.
 */
import { createLogger } from '../util/logger.js';
import { entityOf } from './androidPayload.js';

const defaultLog = createLogger('alert-history');

/** How long an event is kept: 30 days, the history the Alerts page shows. */
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The most events kept. A month of a homelab's alerts is tens to a few
 * hundred, so 30 days fit with room; a flapping service makes two a cycle, and
 * then the newest 1000 are kept rather than the file growing without end. An
 * event is about 400 bytes, so the history adds at most ~400 KB to the push
 * snapshot file, which is written when a page is queued or sent.
 */
export const HISTORY_CAP = 1000;

/** The page size GET /api/events gives when not asked, and the most it gives. */
export const EVENTS_PAGE_DEFAULT = 50;
export const EVENTS_PAGE_MAX = 200;

export const SEVERITIES = Object.freeze(['critical', 'warning', 'info']);
const SEVERITY_SET = new Set(SEVERITIES);
export const PUSH_STATES = Object.freeze(['off', 'queued', 'sent', 'suppressed', 'unsent', 'dropped']);
const PUSH_STATE_SET = new Set(PUSH_STATES);

const ID = /^[1-9]\d{0,15}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;
const textOrNull = (v) => (typeof v === 'string' ? v : null);

/**
 * What push did with an event, from the sender's tally of it ({ sent,
 * suppressed }: the phones that took it, and those whose settings turned it
 * off). `end`: 'done' when every phone is done with it, 'pending' while some
 * are still owed it, 'dropped' when the outbox let it go. Once a phone got
 * it, it is sent.
 *
 * @param {{ sent?: number, suppressed?: number } | undefined} tally
 * @param {'done' | 'pending' | 'dropped'} end
 */
export function pushOutcome(tally, end) {
  const phones = tally?.sent ?? 0;
  const suppressed = tally?.suppressed ?? 0;
  if (phones > 0) return { state: 'sent', phones, suppressed };
  if (end === 'pending') return { state: 'queued', phones: 0, suppressed };
  if (end === 'dropped') return { state: 'dropped', phones: 0, suppressed };
  return { state: suppressed > 0 ? 'suppressed' : 'unsent', phones: 0, suppressed };
}

/** A record as the file holds it, or null for anything that isn't one. */
function readRecord(raw) {
  if (!isObject(raw)) return null;
  const { id, at, type, severity, entity, title, body, reason, node, key, push } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  if (typeof type !== 'string' || type === '' || !SEVERITY_SET.has(severity)) return null;
  if (entity !== null && typeof entity !== 'string') return null;
  if (reason !== null && typeof reason !== 'string') return null;
  if ([title, body, node, key].some((v) => typeof v !== 'string')) return null;
  if (!isObject(push) || !PUSH_STATE_SET.has(push.state)) return null;
  if (!isCount(push.phones) || !isCount(push.suppressed)) return null;
  return {
    id,
    at,
    type,
    severity,
    entity,
    title,
    body,
    reason,
    node,
    key,
    push: { state: push.state, phones: push.phones, suppressed: push.suppressed },
  };
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]   the clock that stamps `at` and ages events out
 * @param {number} [opts.cap]         the most events kept (HISTORY_CAP)
 * @param {number} [opts.maxAgeMs]    how long an event is kept (HISTORY_MAX_AGE_MS)
 * @param {object} [opts.logger]
 */
export function createAlertHistory({
  now = () => Date.now(),
  cap = HISTORY_CAP,
  maxAgeMs = HISTORY_MAX_AGE_MS,
  logger = defaultLog,
} = {}) {
  let lastId = 0;
  /** Oldest first, by id. */
  let records = [];
  /** @type {Map<string, any>} */
  const byId = new Map();

  /** Drop what is past 30 days, then the oldest past the cap. */
  function prune() {
    const cutoff = now() - maxAgeMs;
    let kept = records.filter((r) => Date.parse(r.at) >= cutoff);
    if (kept.length > cap) kept = kept.slice(kept.length - cap);
    if (kept.length === records.length) return;
    const keep = new Set(kept);
    for (const r of records) if (!keep.has(r)) byId.delete(r.id);
    records = kept;
  }

  return {
    /**
     * Start from what the file holds under `history` (undefined: nothing
     * recorded yet). Anything unusable starts empty, with one warn line that
     * quotes none of it (#504); a record that can't be read is dropped and
     * the rest kept, with one warn line counting them.
     */
    load(raw) {
      records = [];
      byId.clear();
      lastId = 0;
      if (raw === undefined) return;
      if (!isObject(raw) || !Array.isArray(raw.events)) {
        logger.warn({}, 'alert history unreadable: starting with none');
        return;
      }
      let dropped = 0;
      for (const item of raw.events) {
        const record = readRecord(item);
        if (record === null || byId.has(record.id)) {
          dropped += 1;
          continue;
        }
        byId.set(record.id, record);
        records.push(record);
      }
      records.sort((a, b) => Number(a.id) - Number(b.id));
      const last = records.length > 0 ? Number(records[records.length - 1].id) : 0;
      lastId = Math.max(last, isCount(raw.lastId) ? raw.lastId : 0);
      if (dropped > 0) {
        logger.warn({ dropped, kept: records.length }, 'alert history: dropped events it cannot read');
      }
      prune();
    },

    /**
     * Record a cycle's events, in their order, each `state` ('off' with push
     * not set up, else 'queued'). Returns their ids.
     *
     * @param {Array<object>} events  from diffSnapshots
     * @param {'off' | 'queued'} state
     * @returns {string[]}
     */
    record(events, state) {
      const at = new Date(now()).toISOString();
      const ids = [];
      for (const event of events) {
        lastId += 1;
        const record = {
          id: String(lastId),
          at,
          type: String(event.type),
          severity: SEVERITY_SET.has(event.severity) ? event.severity : 'info',
          entity: entityOf(event),
          title: String(event.title ?? ''),
          body: String(event.body ?? ''),
          reason: textOrNull(event.reason),
          node: String(event.node ?? ''),
          key: String(event.id ?? ''),
          push: { state, phones: 0, suppressed: 0 },
        };
        records.push(record);
        byId.set(record.id, record);
        ids.push(record.id);
      }
      prune();
      return ids;
    },

    /**
     * Set what push did with record `id` (pushOutcome). A sent record stays
     * sent, with the most phones it was counted at. False when the record is
     * gone (aged out, past the cap) or unknown.
     *
     * @param {string | undefined} id
     * @param {{ state: string, phones: number, suppressed: number }} outcome
     */
    settle(id, outcome) {
      const record = id === undefined ? undefined : byId.get(id);
      if (!record) return false;
      const was = record.push;
      if (was.state === 'sent') {
        if (outcome.state !== 'sent') return true;
        record.push = {
          state: 'sent',
          phones: Math.max(was.phones, outcome.phones),
          suppressed: Math.max(was.suppressed, outcome.suppressed),
        };
        return true;
      }
      record.push = { state: outcome.state, phones: outcome.phones, suppressed: outcome.suppressed };
      return true;
    },

    /** What the file holds under `history`: null until an event was ever recorded. */
    toFile() {
      prune();
      if (lastId === 0) return null;
      return { lastId, events: records };
    },

    /**
     * One page, newest first: the events older than `before` (an id, as a
     * number; null for the newest), of the entities and severities asked
     * (null: any), at most `limit`. `next` is the id to pass as `before` for
     * the page after, or null when there is none. The page is a copy. A new
     * event gets a higher id, so it never moves a page a client is reading.
     *
     * @param {{ before?: number | null, limit?: number, entities?: Set<string> | null, severities?: Set<string> | null }} [query]
     * @returns {{ events: object[], next: string | null }}
     */
    page({ before = null, limit = EVENTS_PAGE_DEFAULT, entities = null, severities = null } = {}) {
      prune();
      const events = [];
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const r = records[i];
        if (before !== null && Number(r.id) >= before) continue;
        if (entities && !entities.has(r.entity)) continue;
        if (severities && !severities.has(r.severity)) continue;
        if (events.length === limit) return { events, next: events[events.length - 1].id };
        events.push(structuredClone(r));
      }
      return { events, next: null };
    },
  };
}
