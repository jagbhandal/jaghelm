import React, { useEffect, useState } from 'react';
import BackHeader from '../components/BackHeader.jsx';
import { getPushStatus, getPushPrefs, setPushPrefs } from '../push/pushPrefsApi.js';
import { disablePush } from '../push/registerPush.js';
import { getPref } from '../storage/prefsAdapter.js';
import { PUSH_TOKEN_KEY } from '../runtimeConfig.js';
import { logout, forgetDevice } from '../auth/authState.js';

// Plural UI label -> singular pref key (the server prefs schema is singular).
const CATEGORIES = [
  ['service', 'Services'],
  ['host', 'Hosts'],
  ['ups', 'UPS'],
  ['cron', 'Cron'],
];

/**
 * The ONLY in-app settings surface (deep config stays on the desktop web app).
 * Loads the per-device prefs (GET /push/prefs?token=<FCM>) and reflects server
 * delivery availability (GET /push/status). When status is unavailable or no
 * device token is registered, the screen grays out rather than showing a false
 * "push on". Toggles write OPTIMISTICALLY then PUT the FULL prefs object (Task 8).
 */
export default function NotificationSettings({ nav }) {
  const [state, setState] = useState({ status: 'loading' }); // loading|unavailable|ready
  const [prefs, setPrefs] = useState(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tok = await getPref(PUSH_TOKEN_KEY);
        if (!tok) { if (!cancelled) setState({ status: 'unavailable', reason: 'not-registered' }); return; }
        const { enabled } = await getPushStatus();
        if (!enabled) { if (!cancelled) setState({ status: 'unavailable', reason: 'no-creds' }); return; }
        const loaded = await getPushPrefs(tok);
        if (cancelled) return;
        setToken(tok);
        setPrefs(loaded);
        setState({ status: 'ready' });
      } catch {
        if (!cancelled) setState({ status: 'unavailable', reason: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The SOLE in-app DELETE trigger (locked decision 9): hard-unregister this
  // device. Distinct from the master toggle's SOFT PUT enabled:false (token
  // KEPT). After the backend DELETE + local clear resolve, the FCM token is
  // gone, so the screen drops to the unavailable / "turned off" state.
  const onTurnOff = async () => {
    await disablePush(token);
    setPrefs(null);
    setToken(null);
    setState({ status: 'unavailable', reason: 'turned-off' });
  };

  return (
    <section className="mobile-view" aria-label="Notification settings">
      <BackHeader title="Notifications" onBack={nav.pop} />

      {state.status === 'loading' && <p className="mobile-view__todo">Loading…</p>}

      {state.status === 'unavailable' && (
        <p className="notif-unavailable">
          {state.reason === 'turned-off'
            ? 'Push is turned off on this device. Re-enable notifications in system settings, then reopen the app.'
            : state.reason === 'not-registered'
              ? 'Push not registered on this device. Enable notifications in system settings, then reopen the app.'
              : 'Push notifications are unavailable — the server has no notification credentials configured.'}
        </p>
      )}

      {state.status === 'ready' && prefs && (
        <Controls prefs={prefs} setPrefs={setPrefs} token={token} onTurnOff={onTurnOff} />
      )}

      <SessionControls />
    </section>
  );
}

/**
 * Session controls. Log out clears the session token and drops to the re-auth
 * screen (the saved server URL is kept). Forget-this-device wipes the URL +
 * sign-in entirely and returns to first-run; it is gated behind an inline
 * confirm since it is destructive of the on-device setup. Neither ever touched
 * a password — only the token is stored.
 */
function SessionControls() {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="session-controls">
      <h2 className="detail-section">Session</h2>
      <button type="button" className="session-logout" onClick={() => logout()}>
        Log out
      </button>
      {!confirming ? (
        <button type="button" className="session-forget" onClick={() => setConfirming(true)}>
          Forget this device
        </button>
      ) : (
        <div className="session-forget-confirm">
          <p className="notif-unavailable">
            Forget this device? This wipes the saved server URL and sign-in from this phone.
          </p>
          <button type="button" className="session-forget" onClick={() => forgetDevice()}>
            Forget
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function Controls({ prefs, setPrefs, token, onTurnOff }) {
  // Apply a full-prefs change optimistically, PUT the COMPLETE object, revert on
  // failure. PUT is a strict full-replace: the body is always the entire
  // {categories{4}, notifyRecoveries, enabled} shape — no PATCH, no extra keys.
  const apply = async (next) => {
    const prev = prefs;
    setPrefs(next);
    try {
      const saved = await setPushPrefs(token, next);
      setPrefs(saved);
    } catch {
      setPrefs(prev); // revert optimistic change
    }
  };

  const toggleCategory = (key) =>
    apply({ ...prefs, categories: { ...prefs.categories, [key]: !prefs.categories[key] } });
  const toggleRecoveries = () => apply({ ...prefs, notifyRecoveries: !prefs.notifyRecoveries });
  const toggleEnabled = () => apply({ ...prefs, enabled: !prefs.enabled });

  return (
    <div className="notif-controls">
      <h2 className="detail-section">Categories</h2>
      {CATEGORIES.map(([key, label]) => (
        <label key={key} className="notif-row">
          <span className="notif-row__label">{label}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={label}
            className="notif-switch"
            checked={!!prefs.categories[key]}
            onChange={() => toggleCategory(key)}
          />
        </label>
      ))}
      <h2 className="detail-section">Recovery</h2>
      <label className="notif-row">
        <span className="notif-row__label">Also notify on recovery</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Notify on recovery"
          className="notif-switch"
          checked={!!prefs.notifyRecoveries}
          onChange={toggleRecoveries}
        />
      </label>
      <h2 className="detail-section">Push</h2>
      <label className="notif-row">
        <span className="notif-row__label">Push notifications</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable push notifications"
          className="notif-switch"
          checked={!!prefs.enabled}
          onChange={toggleEnabled}
        />
      </label>
      <button
        type="button"
        className="notif-turnoff"
        onClick={onTurnOff}
      >
        Turn off push on this device
      </button>
    </div>
  );
}
