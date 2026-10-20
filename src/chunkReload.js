// Reload once when a lazy chunk is gone after a deploy (#379).
//
// A tab still running an older build asks for that build's hashed Settings or
// iframe chunk, which the new deploy no longer has: the server answers 404
// (#256), the import fails and React would show the full-screen error. Vite's
// preload helper wraps every lazy import() in the build and fires a cancelable
// `vite:preloadError` on window when one fails, whether a preloaded dependency
// or the import itself. On the first failure in a build we cancel it and
// reload, so the page comes back on the new build, on the page that was open.
//
// The same event also fires for a chunk that is served but throws while it
// evaluates, and for a fetch that fails because the browser is offline. Both
// get the one reload too. Offline, the reload brings back the cached shell of
// the same build; either way the retry fails on a build that already reloaded,
// so the error screen shows.
//
// The guard is the build itself: main.jsx passes the entry chunk's URL, whose
// content hash changes whenever any lazy chunk's name does. Before reloading we
// store that build in sessionStorage. A failure on a build that is already
// stored there means the reload didn't bring a new build (the chunk is broken
// in this one), so it goes to the normal error screen, however much later it
// happens. The next deploy is a different build and gets its own reload. When
// sessionStorage is blocked or doesn't keep what it is given, we never reload:
// the error screen is better than a possible loop.
//
// Cancelling the event makes the import resolve to undefined, and React then
// throws while rendering the lazy view. ErrorBoundary asks chunkReloadPending()
// and renders nothing meanwhile, so the error screen doesn't flash before the
// page goes. If reload() throws, the event isn't cancelled and the error shows.
// If the page is still here RELOAD_STALL_MS after asking (the navigation was
// cancelled), pending ends and the boundaries show the error screen.
//
// The open page comes back by itself: the URL names it (src/router, #296), and
// a reload keeps the URL.

export const RELOAD_KEY = 'jaghelm-chunk-reload';

// A reload normally replaces the page in well under a second; one still here
// after this long isn't going to happen.
export const RELOAD_STALL_MS = 10_000;

let pending = false;
let stallTimer = null;
const stallListeners = new Set();

/** True once a reload has been started; the page is about to be replaced. */
export function chunkReloadPending() {
  return pending;
}

/**
 * Call `listener` if a started reload stalls: pending has just ended and the
 * page is still here. Returns a function that stops listening.
 */
export function onChunkReloadStall(listener) {
  stallListeners.add(listener);
  return () => stallListeners.delete(listener);
}

/**
 * Record this build as reloaded and say whether the reload may go ahead: false
 * when this build already reloaded once, or when storage throws or loses the
 * write. Never throws.
 */
function claimReload(getStorage, build) {
  try {
    const storage = getStorage();
    if (storage.getItem(RELOAD_KEY) === build) return false;
    storage.setItem(RELOAD_KEY, build);
    return storage.getItem(RELOAD_KEY) === build;
  } catch {
    return false;
  }
}

/**
 * Listen for `vite:preloadError` on window. Called once from main.jsx before the
 * app renders, with `build` naming the running build. The other options exist
 * for tests. Returns a function that removes the listener and clears the
 * pending state.
 */
export function installChunkReload({
  build,
  getStorage = () => window.sessionStorage,
  reload = () => window.location.reload(),
} = {}) {
  const onPreloadError = (event) => {
    if (pending) {
      // A view's CSS preload and its import() can both fail in one page.
      event.preventDefault();
      return;
    }
    if (!build || !claimReload(getStorage, build)) return;
    pending = true;
    try {
      reload();
    } catch {
      pending = false;
      return;
    }
    event.preventDefault();
    stallTimer = setTimeout(() => {
      stallTimer = null;
      pending = false;
      for (const listener of [...stallListeners]) listener();
    }, RELOAD_STALL_MS);
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError);
    clearTimeout(stallTimer);
    stallTimer = null;
    pending = false;
  };
}
