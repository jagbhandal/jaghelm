/*
 * What the status components share (spec §5.2, §6; #287): the five states, the
 * word each one reads as when no other is given, and which look they draw.
 *
 * States are the server status model's: ok, warn, crit, unknown (no signal)
 * and maintenance. The Android app still names them by its own severities
 * (mobile/src/data/derive.js) until it moves onto that model (spec §9), so a
 * component takes either `state` or `severity`, and `toState` reads both.
 *
 * Two looks, as a stopgap until Phase 4 (#326) rebuilds the Android screens
 * on src/ui/:
 *
 *  - `ui`: the signed-off mock's, drawn from the role tokens. The web app's.
 *  - `android`: the Android app's own, unchanged: the class names its
 *    MobileApp.css styles, in the `legacy` layer, so its screens look as they
 *    did when these components lived in mobile/src/components/.
 *
 * Each build picks one with its `__ANDROID_LOOK__` define: true in
 * mobile/vite.config.mobile.js, false in vite.config.js, and so in each app's
 * tests too. Each component reads it in a one-line switch,
 * `if (__ANDROID_LOOK__) return <AndroidStatusLamp {...props} />`, never
 * through an import: there the bundler sees a literal, so each bundle leaves
 * the other look out, down to the icons it imports. (Read through an exported
 * constant, it stayed a variable until the minifier, and the APK kept the web
 * row's chevron and Lucide's runtime.) There is no per-use override: the web
 * tests check the `ui` look, and the Android app's tests check the `android`
 * look. In the Android build a component without an Android look of its own
 * (StatusBadge) still draws the Android lamp; nothing there uses it. #326
 * deletes the define, the Android look and this note.
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

// A screen reader spells an abbreviated word out, so TalkBack doesn't read
// "UNKN" letter by letter. The word on screen stays as it is.
const SPOKEN = { UNKN: 'unknown' };

/** `word` as a screen reader should say it. */
export function spoken(word) {
  return SPOKEN[word] ?? word;
}
