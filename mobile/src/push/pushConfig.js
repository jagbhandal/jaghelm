/**
 * Build-time push-configured flag.
 *
 * `PushNotifications.register()` calls `FirebaseMessaging.getInstance()` natively;
 * without a Firebase config (google-services.json) that throws an UNCAUGHT
 * IllegalStateException on the CapacitorPlugins thread and HARD-crashes the app —
 * it is NOT catchable from JavaScript. So push must be gated OFF unless the build
 * actually shipped Firebase config.
 *
 * `__PUSH_ENABLED__` is replaced at build by a Vite `define` in
 * vite.config.mobile.js, which mirrors the Android gradle's own
 * `google-services.json`-exists conditional. The `typeof` guard keeps this safe
 * in any context where the define wasn't applied (defaults to disabled).
 */
export function isPushConfigured() {
  return typeof __PUSH_ENABLED__ !== 'undefined' && __PUSH_ENABLED__ === true;
}
