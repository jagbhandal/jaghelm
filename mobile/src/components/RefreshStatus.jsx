import React, { useState, useEffect } from 'react';
import { StatusLamp } from '@ui/status-lamp';
import { formatClock } from '../data/derive.js';

/**
 * Pinned worst-of annunciator strip (spec §7.1). Persists across all four tabs.
 *
 *  - Left:  StatusLamp (color = overall `severity`) + the mono status sentence
 *           ("2 services down" / "All systems operational").
 *  - Right: `HH:MM · next Xs` — clock in `--muted`, the "next Xs" countdown in
 *           `--accent-light` (chrome, NOT a status color).
 *  - Bottom: indigo (`--accent`) progress line filling over exactly one
 *           `intervalMs`; `key={lastUpdated}` restarts it; reduced-motion → static.
 *
 * States (severity carries meaning; chrome carries cadence):
 *  - error/unreachable → STEEL lamp + "Can't reach JagHelm" + "Retrying…" + a
 *    frozen steel progress line. Unreachable is UNKNOWN, never red, never green
 *    (spec §13 decision #2 / Bug #4). MobileApp already forces `severity` to
 *    'unknown' here, but the copy is owned by this component.
 *  - loading (no data yet) → steel lamp + "Connecting…", no countdown.
 *  - live → `severity` lamp + `summary` sentence + clock + indigo countdown.
 *
 * `severity`/`summary` are computed by MobileApp from the dashboard data (with
 * `unreachable = data.error != null` threaded into `overallSeverity`). Tap = refresh.
 * `foreground=false` (the app is in the background) pauses the 1 s heartbeat.
 */

// Overall severity → colorblind-safe lamp shape (mirrors SubsystemCell's mapping).
const SEV_SHAPE = { critical: 'slash', caution: 'disc', healthy: 'disc', unknown: 'ring' };

export default function RefreshStatus({
  severity,
  summary,
  lastUpdated,
  intervalMs,
  error,
  loading,
  foreground = true,
  onRefresh,
}) {
  const [now, setNow] = useState(() => Date.now());

  // 1s heartbeat drives the countdown text only. The progress line itself is a
  // CSS animation (smooth, no per-frame JS in steady state). It runs only while
  // the app is in the foreground (`foreground` comes from useDashboard's
  // appStateChange listener, the one that also stops polling), and ticks at once
  // when it restarts so a return from the background shows the real countdown.
  useEffect(() => {
    if (!foreground) return undefined;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [foreground]);

  const unreachable = !!error;
  const elapsed = lastUpdated == null ? null : Math.max(0, now - lastUpdated);
  const remainingS = elapsed == null ? null : Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));

  // Resolve the annunciator state. Precedence: unreachable > cold-start > live.
  let lampSeverity;
  let lampShape;
  let sentence;
  let mod;
  let countdown = false;
  let frozen = false;

  if (unreachable) {
    lampSeverity = 'unknown';
    lampShape = 'ring';
    sentence = "Can't reach JagHelm";
    mod = 'error';
    frozen = true;
  } else if (lastUpdated == null) {
    lampSeverity = 'unknown';
    lampShape = 'ring';
    sentence = 'Connecting…';
    mod = 'loading';
  } else {
    lampSeverity = severity || 'unknown';
    lampShape = SEV_SHAPE[lampSeverity] || 'disc';
    sentence = summary || '';
    mod = lampSeverity;
    countdown = true;
  }

  return (
    <button
      type="button"
      className={`mobile-statusbar mobile-statusbar--${mod}`}
      onClick={onRefresh}
      aria-label={unreachable ? "Can't reach JagHelm. Tap to retry." : `${sentence}. Tap to refresh now.`}
    >
      <span className="mobile-statusbar__left">
        <StatusLamp shape={lampShape} severity={lampSeverity} label={sentence} size={10} />
        <span className="mobile-statusbar__summary">{sentence}</span>
      </span>

      <span className="mobile-statusbar__right">
        {unreachable ? (
          <span className="mobile-statusbar__retry">Retrying…</span>
        ) : countdown ? (
          <>
            <span className="mobile-statusbar__clock" style={{ color: 'var(--muted)' }}>
              {formatClock(lastUpdated)}
            </span>
            <span className="mobile-statusbar__sep" aria-hidden="true">·</span>
            <span className="mobile-statusbar__next" style={{ color: 'var(--accent-light)' }}>
              next {remainingS}s
            </span>
          </>
        ) : null}
      </span>

      {/* Progress line: animated indigo fill (live) or frozen steel (unreachable). */}
      {frozen ? (
        <span className="mobile-statusbar__progress mobile-statusbar__progress--frozen" aria-hidden="true" />
      ) : countdown ? (
        <span
          key={lastUpdated}
          className="mobile-statusbar__progress"
          style={{ animationDuration: `${intervalMs}ms` }}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
