/*
 * The one clock (#480, #559): one "now" for every age on screen and every
 * judge of how old an answer is, so two that read the same time never
 * disagree, whenever each was drawn. The header's "Updated 12 s ago" and
 * "last known 3 min ago" (useAgo), whether the status is stale
 * (src/shell/statusFreshness.js) and the Overview sections' "updated … ago"
 * notes (src/shell/useDashboardData.js) all read it.
 *
 * It moves, and tells every listener at the same moment, only when something
 * needs it to:
 *
 *   - each second while an age is on screen (`subscribe`);
 *   - at the next deadline a judge watches (`watch`): one timer, to the
 *     earliest, for every judge; a judge whose deadline may have come nearer
 *     (an answer after none, a source that starts failing) calls `rearm`. A
 *     timer that fires early finds every deadline ahead, and waits again;
 *   - at once as the tab is shown again, before anything the same event
 *     re-renders (on the window, in the capture phase): a hidden tab's timers
 *     are held back, so it reads the time, not its last tick;
 *   - as the machine wakes from sleep: its overdue timer fires, late.
 *
 * Between moves `now` holds, so whatever renders in between reads the moment
 * every judge last read. With no listener it stops, reads the time itself,
 * and the next listener starts it at the time.
 */

// The longest delay setTimeout holds (24.8 days): a longer one fires at once.
const LONGEST_TIMER = 2 ** 31 - 1;

let now = Date.now();
const tickers = new Set();
const watchers = new Set();
let ticking = null;
let timer = null;

const listening = () => tickers.size + watchers.size > 0;

function notify() {
  const listeners = new Set(tickers);
  for (const w of watchers) listeners.add(w.listener);
  for (const listener of listeners) listener();
}

/** The time, for every listener at once; then the next deadline. */
function move() {
  now = Date.now();
  notify();
  arm();
}

/**
 * One timer, to the earliest deadline still ahead; one already due moves the
 * clock now. A deadline further off than the longest timer (a clock set
 * back) gets the longest, and the clock re-arms for the rest when it runs out.
 */
function arm() {
  clearTimeout(timer);
  timer = null;
  let next = Infinity;
  for (const w of watchers) {
    const at = w.deadline();
    if (at != null && at > now && at < next) next = at;
  }
  if (next === Infinity) return;
  const left = next - Date.now();
  if (left <= 0) move();
  else timer = setTimeout(move, Math.min(left, LONGEST_TIMER));
}

function tick() {
  now = Date.now();
  notify();
}

function shown() {
  if (!document.hidden) move();
}

function start() {
  now = Date.now();
  window.addEventListener('visibilitychange', shown, true);
}

function stopWhenIdle() {
  if (listening()) return;
  clearTimeout(timer);
  timer = null;
  window.removeEventListener('visibilitychange', shown, true);
}

/**
 * The one "now", as of the clock's last move; the time itself while nothing
 * listens (a first render, before its subscription starts the clock).
 */
function get() {
  return listening() ? now : Date.now();
}

/** Each second, for an age on screen; stops when nothing shows one. */
function subscribe(listener) {
  if (!listening()) start();
  tickers.add(listener);
  if (ticking == null) {
    ticking = setInterval(tick, 1000);
    // An age starts from the time, not from the clock's last move.
    move();
  }
  return () => {
    tickers.delete(listener);
    if (tickers.size === 0) {
      clearInterval(ticking);
      ticking = null;
    }
    stopWhenIdle();
  };
}

/**
 * At `deadline()` (ms since the epoch, or null for none), for a judge of
 * staleness: no tick, only a move when the deadline passes, as the tab is
 * shown again, or as anything else moves the clock.
 */
function watch(deadline, listener) {
  if (!listening()) start();
  const w = { deadline, listener };
  watchers.add(w);
  arm();
  return () => {
    watchers.delete(w);
    arm();
    stopWhenIdle();
  };
}

/** A deadline may have come nearer (an answer after none): arm the timer again. */
function rearm() {
  if (watchers.size > 0) arm();
}

export const clock = Object.freeze({ get, subscribe, watch, rearm });
