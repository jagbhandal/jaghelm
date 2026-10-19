// Reload once when a lazy chunk is gone after a deploy (#379).
//
// A tab still running an older build asks for that build's hashed Settings or
// iframe chunk, which the new deploy no longer has: the server answers 404
// (#256), the import fails and React would show the full-screen error. Vite's
// preload helper wraps every lazy import() in the build and fires a cancelable
// `vite:preloadError` on window when one fails, whether a preloaded dependency
// or the import itself. On the first failure we cancel it and reload, so the
// page comes back on the new build.
//
// The guard is a timestamp in sessionStorage: a failure within RELOAD_WINDOW_MS
// of the last reload in this tab is let through to the normal error screen, so
// a chunk that is broken in the current build can't reload in a loop. The flag
// expires rather than being cleared on success, because nothing outside
// App.jsx learns that a lazy chunk loaded (Vite only reports failures), and
// clearing it when the page boots would re-arm the reload before the retry: the
// reload lands on the dashboard, and the chunk loads only on the next click.
// When sessionStorage is blocked or doesn't keep what it is given, we never
// reload: the error screen is better than a possible loop.
//
// Cancelling the event makes the import resolve to undefined, and React then
// throws while rendering the lazy view. ErrorBoundary asks chunkReloadPending()
// and renders nothing meanwhile, so the error screen doesn't flash before the
// page goes.

export const RELOAD_KEY = 'jaghelm-chunk-reload';

// Long enough to cover the retry right after a reload; short enough that the
// next deploy, minutes later, can reload the same tab again.
export const RELOAD_WINDOW_MS = 60_000;

let pending = false;

/** True once a reload has been started; the page is about to be replaced. */
export function chunkReloadPending() {
  return pending;
}

/**
 * Record a reload in storage and say whether it may go ahead: false when the
 * last one was less than RELOAD_WINDOW_MS ago, or when storage throws or loses
 * the write. Never throws.
 */
function claimReload(getStorage, at) {
  try {
    const storage = getStorage();
    const last = Number(storage.getItem(RELOAD_KEY));
    if (last && at - last < RELOAD_WINDOW_MS) return false;
    const stamp = String(at);
    storage.setItem(RELOAD_KEY, stamp);
    return storage.getItem(RELOAD_KEY) === stamp;
  } catch {
    return false;
  }
}

/**
 * Listen for `vite:preloadError` on window. Called once from main.jsx before the
 * app renders. The options exist for tests. Returns a function that removes the
 * listener and clears the pending state.
 */
export function installChunkReload({
  getStorage = () => window.sessionStorage,
  reload = () => window.location.reload(),
  now = () => Date.now(),
} = {}) {
  const onPreloadError = (event) => {
    if (!pending && !claimReload(getStorage, now())) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    pending = false;
  };
}
