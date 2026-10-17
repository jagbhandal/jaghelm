/**
 * Arcane integration config. Pure env -> config; the feature is off unless
 * both ARCANE_URL and ARCANE_API_KEY are set.
 */

function intOr(raw, dflt, min) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, n);
}

export function readArcaneConfig(env = process.env) {
  const url = String(env.ARCANE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(env.ARCANE_API_KEY || '').trim();
  const checkOnlyEnvs = new Set(
    String(env.ARCANE_CHECK_ONLY_ENVS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const pollMs = intOr(env.ARCANE_POLL_SECONDS, 300, 60) * 1000;
  const releaseMs = intOr(env.ARCANE_RELEASE_CHECK_HOURS, 6, 1) * 3600 * 1000;
  return {
    enabled: Boolean(url && apiKey),
    url,
    apiKey,
    checkOnlyEnvs,
    pollMs,
    releaseMs,
    cleartext: /^http:\/\//i.test(url),
  };
}
