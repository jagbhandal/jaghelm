import React from 'react';
// Login.css loads through styles/legacy.css, in the `legacy` cascade layer.

/**
 * Startup screens shown by Root (and ErrorBoundary) instead of a blank page.
 * They reuse the Login screen's layout and carbon tokens (.firstrun.mobile-shell)
 * so they read as part of the app, not a fallback.
 */

/** booting: the startup check is in flight (bounded by BOOT_TIMEOUT_MS). */
export function ConnectingScreen() {
  return (
    <div className="firstrun mobile-shell">
      <div className="login-brand">
        <h1 className="login-wordmark">JagHelm</h1>
        <p className="login-subtitle" role="status">
          Connecting to JagHelm…
        </p>
      </div>
    </div>
  );
}

/** failed / render crash: something unexpected broke; Retry is the way out. */
export function ErrorScreen({ onRetry }) {
  return (
    <div className="firstrun mobile-shell" role="alert">
      <div className="login-brand">
        <h1 className="login-wordmark">Something went wrong</h1>
      </div>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/** unreachable: the saved server didn't answer within the startup deadline. */
export default function ConnectionScreen({ baseUrl, onRetry, onChangeServer }) {
  return (
    <div className="firstrun mobile-shell" role="alert">
      <div className="login-brand">
        <h1 className="login-wordmark">Can&apos;t reach JagHelm</h1>
        {baseUrl && <p className="conn-address">{baseUrl}</p>}
      </div>
      <p className="note">If you&apos;re away from home, check that Tailscale is connected on this phone.</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
      <button type="button" className="secondary" onClick={onChangeServer}>
        Change server
      </button>
    </div>
  );
}
