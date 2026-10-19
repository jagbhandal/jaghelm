/**
 * The mobile app's one polling loop, with explicit start/stop.
 *
 * `run(reason)` performs one fetch round and may return a promise; `reason` is
 * why the round runs:
 *   'force'  — the first load or a tap on the status bar: fetch everything in full.
 *   'resume' — the app came back to the foreground.
 *   'poll'   — the timer fired.
 * `run` owns its own error handling; a throw or rejection is swallowed here so
 * one bad round can't stop the loop.
 *
 * Rules:
 *   - Rounds never overlap. A trigger that lands while a round is in flight is
 *     folded into ONE follow-up round, which takes the strongest reason asked
 *     for (force > resume > poll).
 *   - The next poll is armed `intervalMs` after a round SETTLES, so the status
 *     bar's "next in Ys" (lastUpdated + interval) is when the poll really fires.
 *   - start() while running is a no-op, so a repeated foreground event can't
 *     fetch twice. stop() clears the timer and any queued follow-up; a round
 *     already in flight finishes but arms nothing.
 */

const RANK = { poll: 0, resume: 1, force: 2 };
const stronger = (a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a);

export function createPollScheduler(run, { intervalMs }) {
  let interval = intervalMs;
  let running = false;
  let timer = null;
  let armedAt = 0;
  let inFlight = null; // promise of the round in flight
  let followUp = null; // { reason, promise, resolve } queued behind it

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function setTimer(delay) {
    timer = setTimeout(() => {
      timer = null;
      runNow('poll');
    }, delay);
  }

  function arm() {
    clearTimer();
    if (!running) return;
    armedAt = Date.now();
    setTimer(interval);
  }

  function runNow(reason) {
    clearTimer();
    if (inFlight) {
      if (followUp) {
        followUp.reason = stronger(followUp.reason, reason);
      } else {
        let resolve;
        const promise = new Promise((r) => {
          resolve = r;
        });
        followUp = { reason, promise, resolve };
      }
      return followUp.promise;
    }
    let round;
    try {
      round = Promise.resolve(run(reason));
    } catch {
      round = Promise.resolve();
    }
    inFlight = round
      .catch(() => {})
      .then(() => {
        inFlight = null;
        const next = followUp;
        followUp = null;
        if (next) runNow(next.reason).then(next.resolve);
        else arm();
      });
    return inFlight;
  }

  return {
    /** Start polling with one round now. No-op while already running. */
    start(reason) {
      if (running) return;
      running = true;
      runNow(reason);
    },
    /** Stop polling: no timer, no queued round. A round in flight finishes. */
    stop() {
      running = false;
      clearTimer();
      if (followUp) {
        followUp.resolve();
        followUp = null;
      }
    },
    /** Run a round now (or right after the one in flight); resolves when it settles. */
    refresh(reason = 'force') {
      return runNow(reason);
    },
    /** Change the cadence; a pending poll is re-armed to it, counted from the last round. */
    setIntervalMs(ms) {
      if (ms === interval) return;
      interval = ms;
      if (timer === null) return;
      clearTimer();
      setTimer(Math.max(0, armedAt + interval - Date.now()));
    },
  };
}
