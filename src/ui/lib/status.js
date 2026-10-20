/*
 * What the status components share (spec §5.2, §6; #287): the five states, the
 * word each one reads as when no other is given, and which look they draw.
 *
 * States are the server status model's: ok, warn, crit, unknown (no signal)
 * and maintenance. The Android app still names them by its own severities
 * (mobile/src/data/derive.js) until it moves onto that model (spec §9), so a
 * component takes either `state` or `severity`, and `toState` reads both.
 *
 * Two looks, until Phase 4 rebuilds the Android screens on src/ui/:
 *
 *  - `ui`: the signed-off mock's, drawn from the role tokens. The web app's,
 *    and the default anywhere but the Android build.
 *  - `android`: the Android app's own, unchanged: the class names its
 *    MobileApp.css styles, in the `legacy` layer, so its screens look as they
 *    did when these components lived in mobile/src/components/. The Android
 *    build sets `__ANDROID_LOOK__` (mobile/vite.config.mobile.js), which makes
 *    it the default there. Phase 4 deletes the define and this look.
 *
 * Outside the Android build, a component's `look` prop picks one for a single
 * use (tests, a gallery). In the Android build every component draws the
 * Android look, so its bundle carries none of the `ui` look's code.
 */

/** The five states, as the status model lists them (spec §6). */
export const STATES = Object.freeze(['ok', 'warn', 'crit', 'unknown', 'maintenance']);

/** The word a state reads as when the caller gives none (the mock's Tokens board). */
export const WORDS = Object.freeze({
  ok: 'OK',
  warn: 'Warning',
  crit: 'Critical',
  unknown: 'No signal',
  maintenance: 'Maintenance',
});

// The Android app's severities, and back. Maintenance has no Android severity:
// the app never shows it before Phase 1 brings the status model.
const FROM_SEVERITY = { healthy: 'ok', caution: 'warn', critical: 'crit', unknown: 'unknown' };
const TO_SEVERITY = {
  ok: 'healthy',
  warn: 'caution',
  crit: 'critical',
  unknown: 'unknown',
  maintenance: 'maintenance',
};

/**
 * The state for a `state` or an Android `severity`. Anything else is no
 * signal: never green, never red (spec §6).
 */
export function toState(value) {
  if (STATES.includes(value)) return value;
  return FROM_SEVERITY[value] ?? 'unknown';
}

/** The Android app's severity for a state or a severity: its class names use it. */
export function toSeverity(value) {
  if (Object.hasOwn(FROM_SEVERITY, value)) return value;
  return TO_SEVERITY[toState(value)];
}

/**
 * The look the status components draw: `android` in the Android build, `ui`
 * elsewhere. A build constant, so each bundle leaves the other look's code
 * out. Only outside the Android build does a component's `look` pick another.
 */
export const DEFAULT_LOOK =
  typeof __ANDROID_LOOK__ !== 'undefined' && __ANDROID_LOOK__ === true ? 'android' : 'ui';

// A screen reader spells an abbreviated word out, so TalkBack doesn't read
// "UNKN" letter by letter. The visible word stays as it is.
const SPOKEN = { UNKN: 'unknown' };

/** `word` as a screen reader should say it. */
export function spoken(word) {
  return SPOKEN[word] ?? word;
}
