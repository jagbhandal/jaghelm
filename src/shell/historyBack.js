/**
 * One Back per sheet close (#837). A sheet that is a history entry of its own
 * (a row's detail, entityNav.js closeEntity, #303; a Monitoring drill-down,
 * drillSheet.js, #833) closes by `history.back()`, and tells whether its entry
 * is still there from `history.state`. That state changes only when the
 * browser's `popstate` lands, a moment after `back()`; a second quick tap in
 * between still sees the entry and would go back again, popping the entry
 * under the sheet: the page the user was on. So a close that has called
 * `back()` is pending until `popstate`, and a close during that is ignored.
 *
 * The flag is cleared by:
 *  - `popstate`, whoever caused it (the tap's own back, or the hardware Back
 *    arriving while it was pending). It is needed by itself: Back then Forward
 *    restores the sheet's entry with no sheet opening, and its `history.state`
 *    is the object the flag was set on;
 *  - `pagehide`, and `pageshow` of a page restored from the bfcache: a back()
 *    that loads another document fires no `popstate`, and the flag must not
 *    come back with the restored page;
 *  - a sheet opening (clearBackPending), or unmounting (the one that set it).
 * The flag also holds the entry it was set on: when the current entry is
 * another one, nothing is pending. The listeners exist only while a Back is
 * pending.
 */

/** The `history.state` object of the entry a Back is pending from, or null. */
let from = null;
/** Who set it (a token), so only that sheet's unmount clears it. */
let owner = null;

const NO_STATE = {};

const EVENTS = ['popstate', 'pagehide', 'pageshow'];

/** @param {Event} event */
function settle(event) {
  // A page shown from scratch has nothing pending; only a restored one needs this.
  if (event.type === 'pageshow' && !(/** @type {PageTransitionEvent} */ (event).persisted)) return;
  clearBackPending();
}

/**
 * `history.back()` unless one is already pending.
 *
 * @param {object} [by]  the closing sheet's token, for clearBackPending(by)
 * @returns {boolean} whether it went back (false: a Back was already pending)
 */
export function backOnce(by = NO_STATE) {
  if (from !== null && (window.history.state ?? NO_STATE) === from) return false;
  clearBackPending();
  // A null state cannot be told from "none pending", so it is stood in for.
  from = window.history.state ?? NO_STATE;
  owner = by;
  for (const type of EVENTS) window.addEventListener(type, settle);
  window.history.back();
  return true;
}

/**
 * Forgets a pending Back: a sheet opened, so no close is waiting. With `by`
 * (an unmounting sheet's token) only the Back that sheet set is forgotten.
 *
 * @param {object} [by]
 */
export function clearBackPending(by) {
  if (by !== undefined && owner !== by) return;
  from = null;
  owner = null;
  for (const type of EVENTS) window.removeEventListener(type, settle);
}
