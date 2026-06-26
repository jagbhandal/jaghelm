/**
 * Tiny registry the shell uses to expose user-initiated session controls
 * (log out, forget device) to deep children — the settings screen — without
 * prop-drilling through the dynamic nav stack. App.jsx registers real handlers
 * on mount; NotificationSettings calls logout() / forgetDevice(). Defaults are
 * safe no-ops so a call before registration can never throw.
 */
let handlers = { logout: () => {}, forgetDevice: () => {} };

/** Register session-control handlers (merges over any existing). */
export function setAuthHandlers(next) {
  handlers = { ...handlers, ...next };
}

/** Clear the session token and drop to the re-auth screen (keeps the URL). */
export function logout() {
  return handlers.logout();
}

/** Wipe token + URL + remember and drop to first-run. */
export function forgetDevice() {
  return handlers.forgetDevice();
}
