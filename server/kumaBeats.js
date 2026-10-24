// @ts-check
/**
 * Kuma's heartbeat strip (#312): each monitor's recent checks, which the
 * service rows, the detail drawer and the phone sheet draw (UptimeBar).
 *
 * Where they come from:
 *
 *  - Kuma's own beats, when the load read them. The status page path
 *    (monitors.js) reads /api/status-page/heartbeat/default every cycle, and
 *    the /metrics path reads it too, as one extra best-effort GET beside
 *    /metrics (#629), matched by monitor id. Its `heartbeatList` holds each
 *    monitor's recent beats (status, time, ping) at Kuma's own interval:
 *    kumaBeats() keeps the newest BEATS_KEPT,
 *    as the monitor's `beats`. Real history, whole again after a restart. A
 *    load whose heartbeat read failed gives `beats: null`, and the last
 *    beats are kept as they were.
 *  - Otherwise a ring JagHelm samples once a cycle: a monitor the /metrics
 *    path got no beats for (its heartbeat read failed, or the status page
 *    doesn't list it; no `beats` key) has only its latest state, so each
 *    cycle's state and response time is one beat, at the cycle's clock, in a ring of BEATS_KEPT per monitor, in memory (ADR 0002): a restart
 *    starts it again.
 *
 * Where a strip's history comes from is said with it (`history`, #671): "kuma"
 * for a monitor whose ring Kuma's own beats filled (stays so through a cycle
 * whose heartbeat read failed), "since-restart" for one that only ever had
 * JagHelm's samples (a monitor off the status page), whose ring starts empty at
 * every restart and is never written to disk (ADR 0002). The web labels those
 * honestly instead of drawing the slots before the restart as outages.
 *
 * A cycle that couldn't read Kuma adds a beat with no data to every ring (the
 * monitors a failed load hands back are the last ones Kuma gave, not new
 * beats), and the strip shows the gap; the next load with Kuma's own beats
 * replaces it with what Kuma saw. A monitor Kuma no longer lists is dropped,
 * so the store holds only Kuma's current monitors, each at most BEATS_KEPT.
 *
 * /api/services carries them (`beats`, by service uid, encodeBeats), beside
 * the latencies the rows already read from it every tick: no request of
 * their own, and nothing in /api/status, whose ETag a strip moving every
 * Kuma interval would otherwise change on a steady board.
 *
 * Dependency-free on purpose: the web decodes what the server encodes
 * (decodeBeats), and the server's runtime image holds server/ but not src/,
 * so a module both sides use lives here (as status/readings.js).
 */

/** How many beats a monitor keeps: the card's "last 50". */
export const BEATS_KEPT = 50;

/**
 * @typedef {{ t: number, s: 0|1|2|3|null, p: number|null }} Beat
 *   `t` when, in ms since the epoch; `s` Kuma's status (0 down, 1 up, 2
 *   pending, 3 maintenance), null with no data; `p` the response time in ms,
 *   null without one
 */

/** @param {unknown} v */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const isObject = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Kuma's status values, as a beat keeps them. */
const KUMA_STATUSES = new Set([0, 1, 2, 3]);
/** @param {unknown} v @returns {0|1|2|3|null} */
const statusOf = (v) => (KUMA_STATUSES.has(/** @type {number} */ (v)) ? /** @type {0|1|2|3} */ (v) : null);
/** @param {unknown} v */
const pingOf = (v) => (num(v) && /** @type {number} */ (v) > 0 ? /** @type {number} */ (v) : null);

/**
 * Kuma status-page heartbeat times are UTC, formatted "YYYY-MM-DD HH:mm:ss.SSS"
 * (no zone suffix). Parse as UTC → epoch ms, or null if missing/unparseable.
 * @param {unknown} t
 */
export function parseBeatTime(t) {
  if (!t || typeof t !== 'string') return null;
  const iso = t.includes('T') ? t : t.replace(' ', 'T');
  const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A monitor's beats from Kuma's `heartbeatList` entry for it: oldest first,
 * the newest `kept`. A beat with no time it can read is left out; a status
 * Kuma doesn't have is no data.
 * @param {unknown} list
 * @returns {Beat[]}
 */
export function kumaBeats(list, kept = BEATS_KEPT) {
  if (!Array.isArray(list)) return [];
  /** @type {Beat[]} */
  const beats = [];
  for (const b of list) {
    if (!isObject(b)) continue;
    const t = parseBeatTime(b.time);
    if (t == null) continue;
    beats.push({ t, s: statusOf(b.status), p: pingOf(b.ping) });
  }
  return beats.sort((a, b) => a.t - b.t).slice(-kept);
}

// A monitor's state (fetchMonitors' `kumaStatus`) as Kuma's status value.
const STATUS_VALUE = { down: 0, up: 1, pending: 2, maintenance: 3 };

/**
 * The beats of every monitor, from Kuma's own when a load has them, else a
 * ring sampled once a cycle (the module's header).
 *
 *   record({ ok, monitors, now })      one cycle's load (fetchMonitors')
 *   encodedFor(monitorOf, { ok })      /api/services' `beats`: for each uid of
 *                                      `monitorOf` (uid → monitor id) whose
 *                                      monitor has beats, encodeBeats' form;
 *                                      while Kuma is unreadable, the uids of
 *                                      the last cycle that read it too
 *   size(id)                           how many beats a monitor has (tests)
 */
export function createBeatStore({ kept = BEATS_KEPT } = {}) {
  /** @type {Map<string, Beat[]>} monitor id → its beats, oldest first */
  const rings = new Map();
  /** @type {Map<string, 'kuma'|'since-restart'>} monitor id → where its ring's history comes from (#671) */
  const sources = new Map();
  /** @type {Record<string, unknown>} */
  let lastMap = {};
  /** @param {Beat[]} ring @param {Beat} beat */
  const push = (ring, beat) => [...ring, beat].slice(-kept);

  return {
    /** @param {{ ok: boolean, monitors?: Record<string, any>|null, now: number }} load */
    record({ ok, monitors, now }) {
      if (!ok) {
        for (const [id, ring] of rings) rings.set(id, push(ring, { t: now, s: null, p: null }));
        return;
      }
      const seen = new Set();
      for (const m of Object.values(monitors ?? {})) {
        if (!isObject(m) || m.id == null) continue;
        const id = String(m.id);
        seen.add(id);
        if (Array.isArray(m.beats)) {
          rings.set(id, m.beats.slice(-kept));
          sources.set(id, 'kuma');
        } else if (m.beats === null) {
          // Kuma's beats unread this time (its heartbeat read failed): the
          // last ones it gave are kept, not emptied and not sampled over.
          if (!rings.has(id)) rings.set(id, []);
          if (!sources.has(id)) sources.set(id, 'kuma');
        } else {
          const s = statusOf(/** @type {Record<string, number>} */ (STATUS_VALUE)[m.kumaStatus]);
          rings.set(id, push(rings.get(id) ?? [], { t: now, s, p: s === 1 ? pingOf(m.ping) : null }));
          // A ring Kuma's beats filled stays Kuma's when one read fails.
          if (!sources.has(id)) sources.set(id, 'since-restart');
        }
      }
      for (const id of [...rings.keys()]) {
        if (seen.has(id)) continue;
        rings.delete(id);
        sources.delete(id);
      }
    },

    /**
     * @param {Record<string, unknown>|null|undefined} monitorOf
     * @param {{ ok: boolean }} kuma
     */
    encodedFor(monitorOf, { ok }) {
      const map = ok ? { ...monitorOf } : { ...lastMap, ...monitorOf };
      if (ok) lastMap = map;
      /** @type {Record<string, ReturnType<typeof encodeBeats>>} */
      const out = {};
      for (const [uid, id] of Object.entries(map)) {
        const ring = id == null ? null : rings.get(String(id));
        if (ring) out[uid] = encodeBeats(ring, sources.get(String(id)) ?? 'kuma');
      }
      return out;
    },

    /** @param {string} id */
    size(id) {
      return rings.get(String(id))?.length ?? 0;
    },
  };
}

/**
 * A monitor's beats as /api/services carries them, one compact object:
 *
 *   t  the oldest beat's time, in seconds since the epoch (null with none)
 *   d  the seconds from each beat to the next (one fewer than the beats)
 *   s  a character per beat, oldest first: Kuma's status, "0" down, "1" up,
 *      "2" pending, "3" maintenance, or "-" with no data
 *   p  each beat's response time in whole ms, 0 without one
 *   history  only on a strip JagHelm sampled itself: "since-restart" (#671).
 *      Absent means Kuma's own beats; decodeHistory reads either
 *
 * About 400 bytes for 50 beats, against about 900 as a list of objects.
 * @param {Beat[]} beats
 * @param {'kuma'|'since-restart'} [history]
 */
export function encodeBeats(beats, history = 'kuma') {
  const secs = beats.map((b) => Math.round(b.t / 1000));
  return {
    t: secs.length ? secs[0] : null,
    d: secs.slice(1).map((s, i) => s - secs[i]),
    s: beats.map((b) => (b.s == null ? '-' : String(b.s))).join(''),
    p: beats.map((b) => (num(b.p) ? Math.round(/** @type {number} */ (b.p)) : 0)),
    ...(history === 'since-restart' && { history }),
  };
}

/**
 * Where a service's strip history comes from (#671): "since-restart" when the
 * server says JagHelm sampled it itself, else "kuma" (also for a server that
 * predates the field, and for anything unreadable: no label is the old look).
 * @param {unknown} encoded
 * @returns {'kuma'|'since-restart'}
 */
export function decodeHistory(encoded) {
  return isObject(encoded) && /** @type {Record<string, unknown>} */ (encoded).history === 'since-restart'
    ? 'since-restart'
    : 'kuma';
}

// Each beat character as the strip draws it: its state (the status roles,
// docs/design-system.md). The tooltip says each state as Kuma's word.
const BEAT_STATE = { 0: 'crit', 1: 'ok', 2: 'warn', 3: 'maintenance' };

/**
 * /api/services' beats for one service (encodeBeats' form) as the strip
 * draws them, oldest first: `{ state, time, ping }` each, `time` in ms (null
 * when the times are missing), `ping` in ms or null. The newest BEATS_KEPT
 * at most, whatever a server sends. [] for a monitor with no beats yet; null
 * for anything else, which draws no strip.
 * @param {unknown} encoded
 * @returns {Array<{ state: string, time: number|null, ping: number|null }>|null}
 */
export function decodeBeats(encoded) {
  if (!isObject(encoded)) return null;
  const { t, d, s, p } = /** @type {Record<string, unknown>} */ (encoded);
  if (typeof s !== 'string' || (t != null && !num(t))) return null;
  const gaps = Array.isArray(d) ? d : [];
  const pings = Array.isArray(p) ? p : [];
  const out = [];
  let at = num(t) ? /** @type {number} */ (t) : null;
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0) at = at != null && num(gaps[i - 1]) ? at + gaps[i - 1] : null;
    out.push({
      state: /** @type {Record<string, string>} */ (BEAT_STATE)[s[i]] ?? 'unknown',
      time: at == null ? null : at * 1000,
      ping: pingOf(pings[i]),
    });
  }
  return out.slice(-BEATS_KEPT);
}
