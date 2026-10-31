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
 * The flag is cleared by that `popstate` (whoever caused it: the tap's own
 * back, or the hardware Back arriving while it was pending), and by a sheet
 * opening or unmounting (clearBackPending). It also holds the entry it was
 * set on: when the current entry is another one, nothing is pending, so the
 * flag cannot outlive a `popstate` that never came.
 */

/** The `history.state` object of the entry a Back is pending from, or null. */
let from = null;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    from = null;
  });
}

/**
 * `history.back()` unless one is already pending.
 *
 * @returns {boolean} whether it went back (false: a Back was already pending)
 */
export function backOnce() {
  if (from !== null && (window.history.state ?? NO_STATE) === from) return false;
  // A null state cannot be told from "none pending", so it is stood in for.
  from = window.history.state ?? NO_STATE;
  window.history.back();
  return true;
}

const NO_STATE = {};

/** Forgets a pending Back: a sheet opened or unmounted, so no close is waiting. */
export function clearBackPending() {
  from = null;
}
