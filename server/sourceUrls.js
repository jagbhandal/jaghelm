// @ts-check
/**
 * The monitoring sources' URLs (#419): PROMETHEUS_URL, KUMA_URL and
 * JAGHELM_GITEA_URL (or its old name GITEA_URL, for one release: env.js, #249).
 * The monitoring sources read them here and nowhere else (sourceUrl,
 * sourceUrlSet). The Gitea integration preset reads JAGHELM_GITEA_URL as its
 * own URL too, through the integrations' check of every URL
 * (integrations/lib/config.js), which asks the same urlCredential.
 *
 * Unset has no default: there is no address that is right inside a container
 * and on a host (#704; `localhost` is JagHelm itself in the shipped bridge
 * compose). An unset PROMETHEUS_URL is a plain state of its own
 * (sourceUrlUnset), neither a refused URL nor an unreachable one; an unset
 * KUMA_URL or JAGHELM_GITEA_URL is a source not set up, quiet. Nothing is
 * requested for either.
 *
 * One that carries a credential (urlCredential in util/redact.js) is refused:
 * it is never requested and never logged, and its source is off. That is
 * `user:pass@` or a user alone, as the parser reads it or not: a password
 * with a raw `#`, `/` or `?` (after digits, `jag:1234#x@host` parses as host
 * `jag`, port 1234), whitespace or a quote, a second URL glued on, the scheme
 * left out; or a key in the query. Node's fetch refuses a URL with userinfo
 * anyway, so a refused URL never worked. An `@` a path really holds after a
 * port is written `%40`.
 *
 * A refused URL's problem names the variable, by the name it is set under, and
 * where the credential goes instead, never the value. The boot warns it once (warnRefusedSourceUrls),
 * the status model makes its source off with it (status/index.js), and
 * /api/health lists it (sourceUrlHealth).
 */

import { readEnv } from './env.js';
import { urlCredential } from './util/redact.js';
import { whatItCarries } from './integrations/lib/urlCredential.js';

/** @typedef {'prometheus' | 'kuma' | 'gitea'} SourceName */

/**
 * Each source's variable, `unset` (the words for a source that is needed and
 * unset; none for an optional one, which is then simply not set up), and
 * where a credential goes instead.
 */
export const SOURCE_URLS = Object.freeze({
  prometheus: Object.freeze({
    variable: 'PROMETHEUS_URL',
    unset: 'Prometheus is not set. Set PROMETHEUS_URL in .env.',
    instead: "JagHelm can't log in to Prometheus",
  }),
  kuma: Object.freeze({
    variable: 'KUMA_URL',
    unset: null,
    instead: 'put the API key in KUMA_API_KEY',
  }),
  gitea: Object.freeze({
    variable: 'JAGHELM_GITEA_URL',
    unset: null,
    instead: 'put the token in JAGHELM_GITEA_TOKEN',
  }),
});

/**
 * The URL a source is read at, or null with none (unset, or a URL
 * refused), and why it is refused, or null. `env` is the process's
 * environment unless a test passes its own.
 * @param {SourceName} name
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string | null, problem: string | null }}
 */
export function sourceUrl(name, env) {
  const { variable, instead } = SOURCE_URLS[name];
  const { value, from } = readEnv(variable, env);
  if (!value) return { url: null, problem: null };
  const found = urlCredential(value);
  if (found) {
    return { url: null, problem: `${from} carries ${whatItCarries(found)}, so it is not used: ${instead}` };
  }
  return { url: value, problem: null };
}

/**
 * The plain words for a needed source whose variable is unset (Prometheus), or
 * null: it is set (refused or not), or optional. The status model shows the
 * source off with them (status/index.js), distinct from "unreachable".
 * @param {SourceName} name
 * @param {Record<string, string | undefined>} [env]
 * @returns {string | null}
 */
export function sourceUrlUnset(name, env) {
  const { variable, unset } = SOURCE_URLS[name];
  return unset && readEnv(variable, env).from === null ? unset : null;
}

/**
 * The needed sources that are unset, by source name ({} with none).
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function sourceUrlUnsets(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of /** @type {SourceName[]} */ (Object.keys(SOURCE_URLS))) {
    const words = sourceUrlUnset(name, env);
    if (words) out[name] = words;
  }
  return out;
}

/**
 * Whether the source's variable is set at all, refused or not: a set
 * KUMA_URL or JAGHELM_GITEA_URL is something set up (the status model's
 * empty board).
 * @param {SourceName} name
 * @param {Record<string, string | undefined>} [env]
 */
export function sourceUrlSet(name, env) {
  return readEnv(SOURCE_URLS[name].variable, env).from !== null;
}

/**
 * Each source's name, the name its variable is set under (its own when
 * unset), and its sourceUrl, in SOURCE_URLS order.
 * @param {Record<string, string | undefined>} [env]
 */
function each(env) {
  return /** @type {SourceName[]} */ (Object.keys(SOURCE_URLS)).map((name) => ({
    name,
    variable: readEnv(SOURCE_URLS[name].variable, env).from ?? SOURCE_URLS[name].variable,
    ...sourceUrl(name, env),
  }));
}

/**
 * The refused sources' problems, by source name ({} with none), for the
 * status model.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function sourceUrlProblems(env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const { name, problem } of each(env)) if (problem) out[name] = problem;
  return out;
}

/**
 * The refused sources for /api/health, by source name ({} with none): `{
 * state: 'refused', variable, problem }`. A source whose URL is used is not
 * listed, so the public probe says nothing of what is set up.
 * @param {Record<string, string | undefined>} [env]
 */
export function sourceUrlHealth(env) {
  /** @type {Record<string, { state: 'refused', variable: string, problem: string }>} */
  const out = {};
  for (const { name, variable, problem } of each(env)) {
    if (problem) out[name] = { state: 'refused', variable, problem };
  }
  return out;
}

/**
 * The boot's one warning per refused source URL, without its value, and one
 * for a needed source (Prometheus) that is unset.
 * @param {{ warn: (fields: object, msg: string) => void }} logger
 * @param {Record<string, string | undefined>} [env]
 */
export function warnRefusedSourceUrls(logger, env) {
  for (const { name, variable, problem } of each(env)) {
    if (problem) logger.warn({ source: name, variable }, problem);
  }
  for (const [name, words] of Object.entries(sourceUrlUnsets(env))) {
    logger.warn({ source: name, variable: SOURCE_URLS[/** @type {SourceName} */ (name)].variable }, words);
  }
}
