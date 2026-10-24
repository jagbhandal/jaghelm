/**
 * Phase-locked polling (#630). The server's background loop builds what
 * /api/status and /api/services serve once a cycle, and says in
 * `X-Next-Refresh-Ms` how long until the next one should have finished: a
 * duration, never a clock time, so this browser's clock can't skew it. The
 * browser polls then (plus a little jitter) instead of on a free-running
 * timer, so what it shows is about a cycle old, not up to two intervals.
 *
 * With no usable hint (an older server, a missing or garbled header, one that
 * has run out) it falls back to the fixed interval, as before. The Settings
 * interval governs both sides: the server's loop follows the saved value, and
 * this follows the server's hint, held to 1 s .. 2 x the interval it is given.
 */

/** The shortest wait a hint can set, ms. */
export const MIN_DELAY_MS = 1000;
/** Up to this much is added to a hint's wait, so tabs don't ask in the same instant. */
export const JITTER_MS = 250;

/** A header's text as a hint in ms, or null when it isn't a non-negative number. */
export function parseHint(text) {
  if (typeof text !== 'string' || !/^\d{1,9}$/.test(text.trim())) return null;
  return Number(text.trim());
}

/**
 * What is left of `hint` at `now`, ms, or null when there is no usable hint or
 * it has run out.
 */
function hintLeftMs(hint, now) {
  if (!hint || !Number.isFinite(hint.ms) || !Number.isFinite(hint.at)) return null;
  const left = hint.ms - (now - hint.at);
  return left > 0 ? left : null;
}

/**
 * How long to wait before the next poll, ms.
 *
 * A hint at or under the floor is the server saying "ask again soon" (its
 * cycle is running or overrunning). `streak` counts the short hints in a row:
 * each waits twice as long as the last, up to the interval, so a slow or
 * wedged cycle is never asked about at 1 Hz. With `retry` off the poll
 * doesn't follow a short hint at all and waits the interval (the tick, which
 * costs three requests). Jitter is added after the floor.
 *
 * @param {{ hint: { ms: number, at: number } | null, now: number, intervalMs: number, random?: () => number, streak?: number, retry?: boolean }} args
 *   `hint` is the last the server sent, `ms` its wait and `at` when it came
 *   (this browser's clock, the same as `now`).
 */
export function nextDelayMs({ hint, now, intervalMs, random = Math.random, streak = 0, retry = true }) {
  const left = hintLeftMs(hint, now);
  // None, or run out: the fixed interval, until an answer brings a new one.
  if (left === null) return intervalMs;
  if (left <= MIN_DELAY_MS) {
    if (!retry) return intervalMs;
    const base = Math.min(intervalMs, MIN_DELAY_MS * 2 ** Math.min(streak, 20));
    return Math.min(base + random() * JITTER_MS, Math.max(intervalMs, MIN_DELAY_MS));
  }
  return Math.min(left + random() * JITTER_MS, 2 * intervalMs);
}

/** The last hint the server sent, as a store (`get`, `subscribe`). */
export function createHintStore(clock = () => Date.now()) {
  let hint = null;
  const listeners = new Set();
  return {
    get: () => hint,
    /** Take a response header's text; anything unusable leaves the last hint as it was. */
    note(text) {
      const ms = parseHint(text);
      if (ms === null) return;
      hint = { ms, at: clock() };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      hint = null;
    },
  };
}

/** The page's one store: every answer from the API notes its hint here. */
export const refreshHints = createHintStore();

/**
 * Calls `fire` on the phase-locked schedule until the returned stop() runs. It
 * doesn't call it at the start. After each call the next is timed from the
 * newest hint; with none left (the answer to this call hasn't come) it waits
 * the fixed interval, and the next hint to arrive re-times it once. A timer
 * already set from a hint is never moved by a later one, so two locks (the
 * status poll and the tick) don't push each other past the cycle they wait for.
 * Short hints in a row back off (nextDelayMs); a hint with real time left
 * resets that.
 */
export function startPhaseLock({
  fire,
  intervalMs,
  hints = refreshHints,
  clock = () => Date.now(),
  random = Math.random,
  retry = true,
}) {
  let id = null;
  let fromHint = false;
  let streak = 0;
  const arm = () => {
    clearTimeout(id);
    const now = clock();
    const hint = hints.get();
    const left = hintLeftMs(hint, now);
    fromHint = left !== null;
    const delay = nextDelayMs({ hint, now, intervalMs, random, streak, retry });
    if (left !== null) streak = left <= MIN_DELAY_MS ? streak + 1 : 0;
    id = setTimeout(() => {
      fire();
      arm();
    }, delay);
  };
  const unsubscribe = hints.subscribe(() => {
    if (!fromHint) arm();
  });
  arm();
  return () => {
    clearTimeout(id);
    unsubscribe();
  };
}
