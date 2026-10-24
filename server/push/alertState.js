// @ts-check
/**
 * Snooze and Ack (#669): what a person told push to leave alone, kept by
 * alert tag (the Web Push payload's `tag`: the alert's entity, or
 * `type:id`), so a notification, its repeat and its recovery share one key.
 *
 * Keys are episodes (dispatch.js alertKey), so silencing one problem on an
 * entity never silences another, and a page of a worse severity than the one
 * silenced (a warning acked, then critical) is never held back.
 *
 *   open    { tag: at }  tags whose page push has handled and whose recovery it
 *                        has not: an incident that is on. Only an open one
 *                        can be acked, so a late tap on a notification for an
 *                        incident that has since recovered cannot silence the
 *                        next one
 *   acks    { tag: at }  no page for the tag until its recovery. The recovery
 *                        itself is sent, and ends the ack
 *   snoozes { tag: until }  no page and no recovery for the tag until then
 *                        (at most 24 h), whatever happens meanwhile
 *
 * The state is one small JSON object, persisted by the owner through `save`
 * (the push file's `producers`, so it shares the outbox's atomic write and
 * survives a restart). Everything is bounded; expired snoozes and week-old
 * open entries are pruned as they are seen. Pure but for `now` and `save`.
 */

export const SNOOZE_MAX_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_DEFAULT_MS = 60 * 60 * 1000;
/** An incident older than this is no longer offered for an ack, nor kept in `open`. */
export const OPEN_MAX_MS = 30 * 24 * 60 * 60 * 1000;
const CAP = 500;

const isObject = (/** @type {unknown} */ v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
/** @returns {Record<string, number>} */
const numbersOf = (/** @type {unknown} */ v) =>
  isObject(v)
    ? /** @type {Record<string, number>} */ (
        Object.fromEntries(
          Object.entries(/** @type {Record<string, unknown>} */ (v)).filter(
            ([k, n]) =>
              typeof n === 'number' && Number.isFinite(n) && k.length > 0 && k.length <= 200
          )
        )
      )
    : {};

/**
 * @param {object} deps
 * @param {unknown | (() => unknown)} [deps.initial]  what `save` last gave (anything: read defensively); a function is called on first use
 * @param {(state: Record<string, Record<string, number>>) => void} [deps.save]
 * @param {() => number} [deps.now]
 */
export function createAlertState({ initial, save = () => {}, now = () => Date.now() }) {
  /** @type {Record<string, number>} */
  let open = {};
  /** @type {Record<string, number>} */
  let acks = {};
  /** @type {Record<string, number>} */
  let snoozes = {};
  /** @type {Record<string, number>} the worst severity rank seen for an open incident, and as it was when silenced */
  let sevs = /** @type {Record<string, number>} */ ({});
  let ackSev = /** @type {Record<string, number>} */ ({});
  let snoozeSev = /** @type {Record<string, number>} */ ({});
  let dirty = false;
  let loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    let start;
    try {
      start = typeof initial === 'function' ? initial() : initial;
    } catch {
      start = undefined;
    }
    const src = isObject(start) ? /** @type {any} */ (start) : {};
    open = numbersOf(src.open);
    acks = numbersOf(src.acks);
    snoozes = numbersOf(src.snoozes);
    sevs = numbersOf(src.sevs);
    ackSev = numbersOf(src.ackSev);
    snoozeSev = numbersOf(src.snoozeSev);
  }

  function prune() {
    const at = now();
    for (const [tag, until] of Object.entries(snoozes)) if (until <= at) delete snoozes[tag];
    for (const table of [ackSev, snoozeSev, sevs]) {
      for (const tag of Object.keys(table)) {
        if (!(tag in open) && !(tag in snoozes) && !(tag in acks)) delete table[tag];
      }
    }
    for (const [tag, since] of Object.entries(open)) if (at - since > OPEN_MAX_MS) delete open[tag];
    for (const [tag, since] of Object.entries(acks))
      if (at - since > OPEN_MAX_MS || !(tag in open)) delete acks[tag];
    for (const table of [open, acks, snoozes]) {
      const keys = Object.keys(table);
      // Oldest first out, past the cap.
      for (const tag of keys
        .sort((a, b) => table[a] - table[b])
        .slice(0, Math.max(0, keys.length - CAP))) {
        delete table[tag];
      }
    }
  }

  return {
    /**
     * Note an event push has handled (sent or silenced): a page opens its
     * tag's incident, a recovery ends it and its ack.
     * @param {string} tag
     * @param {boolean} recovery
     */
    observe(tag, recovery, rank = 0) {
      load();
      if (recovery) {
        if (tag in open || tag in acks || tag in sevs) {
          delete open[tag];
          delete acks[tag];
          delete sevs[tag];
          delete ackSev[tag];
          dirty = true;
        }
      } else {
        if (!(tag in open)) {
          open[tag] = now();
          dirty = true;
        }
        if (rank > (sevs[tag] ?? -1)) {
          sevs[tag] = rank;
          dirty = true;
        }
      }
    },
    /**
     * Whether a page or recovery for `tag` is held back: 'snooze', 'ack' (pages
     * only) or null. A page worse than the incident was when silenced (`rank`:
     * info 0, warning 1, critical 2) is never held back.
     * @param {string} tag
     * @param {boolean} recovery
     * @param {number} [rank]
     * @returns {'snooze' | 'ack' | null}
     */
    suppression(tag, recovery, rank = 0) {
      load();
      const until = snoozes[tag];
      if (until !== undefined && until > now() && (recovery || rank <= (snoozeSev[tag] ?? 2)))
        return 'snooze';
      if (!recovery && tag in acks && rank <= (ackSev[tag] ?? 2)) return 'ack';
      return null;
    },
    /** When the snooze on `tag` ends (ms), or null for none running. */
    snoozedUntil(/** @type {string} */ tag) {
      load();
      const until = snoozes[tag];
      return until !== undefined && until > now() ? until : null;
    },
    /**
     * Ack the open incidents among `tags`. Returns { applied, ignored }: the
     * tags acked, and those that were not open (already recovered, or never
     * seen) and so were left alone.
     * @param {string[]} tags
     */
    ack(tags) {
      load();
      const applied = [];
      const ignored = [];
      for (const tag of tags) {
        if (tag in open) {
          acks[tag] = now();
          ackSev[tag] = sevs[tag] ?? 2;
          applied.push(tag);
        } else ignored.push(tag);
      }
      if (applied.length > 0) dirty = true;
      return { applied, ignored };
    },
    /**
     * Snooze `tags` for `ms` (1 minute to 24 hours; the default an hour).
     * @param {string[]} tags
     * @param {number} [ms]
     */
    snooze(tags, ms = SNOOZE_DEFAULT_MS) {
      load();
      const length = Math.min(
        Math.max(Number.isFinite(ms) ? ms : SNOOZE_DEFAULT_MS, 60_000),
        SNOOZE_MAX_MS
      );
      for (const tag of tags) {
        snoozes[tag] = now() + length;
        snoozeSev[tag] = sevs[tag] ?? 2;
      }
      if (tags.length > 0) dirty = true;
      return { until: now() + length };
    },
    /** Forget any snooze and ack for `tag`. Returns whether there was one. */
    clear(/** @type {string} */ tag) {
      load();
      const had = tag in acks || tag in snoozes;
      delete acks[tag];
      delete snoozes[tag];
      delete ackSev[tag];
      delete snoozeSev[tag];
      if (had) dirty = true;
      return had;
    },
    /** What is switched off now, for Settings: { snoozed: [{ tag, until }], acked: [{ tag, since }] }. */
    view() {
      load();
      const at = now();
      return {
        snoozed: Object.entries(snoozes)
          .filter(([, until]) => until > at)
          .map(([tag, until]) => ({ tag, until }))
          .sort((a, b) => a.until - b.until),
        acked: Object.entries(acks)
          .map(([tag, since]) => ({ tag, since }))
          .sort((a, b) => a.since - b.since),
      };
    },
    /** Write the state when it changed since the last write. Never throws. */
    flush() {
      load();
      if (!dirty) return;
      prune();
      dirty = false;
      try {
        save({
          open: { ...open },
          acks: { ...acks },
          snoozes: { ...snoozes },
          sevs: { ...sevs },
          ackSev: { ...ackSev },
          snoozeSev: { ...snoozeSev },
        });
      } catch {
        dirty = true; // tried again at the next flush
      }
    },
  };
}
