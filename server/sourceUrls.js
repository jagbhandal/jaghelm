// @ts-check
/**
 * The monitoring sources' URLs (#419): PROMETHEUS_URL, KUMA_URL and GITEA_URL.
 * The monitoring sources read them here and nowhere else (sourceUrl,
 * sourceUrlSet). The Gitea integration preset reads GITEA_URL as its own URL
 * too, through the integrations' check of every URL (integrations/lib/config.js),
 * which asks the same urlCredential.
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
 * A refused URL's problem names the variable and where the credential goes
 * instead, never the value. The boot warns it once (warnRefusedSourceUrls),
 * the status model makes its source off with it (status/index.js), and
 * /api/health lists it (sourceUrlHealth).
 */

import { urlCredential } from './util/redact.js';
import { whatItCarries } from './integrations/lib/urlCredential.js';

/** @typedef {'prometheus' | 'kuma' | 'gitea'} SourceName */

/**
 * Each source's variable, the URL it falls back to when unset (Gitea has none:
 * unset, it is not set up), and where a credential goes instead.
 */
export const SOURCE_URLS = Object.freeze({
  prometheus: Object.freeze({
    variable: 'PROMETHEUS_URL',
    fallback: 'http://localhost:9090',
    instead: "JagHelm can't log in to Prometheus",
  }),
  kuma: Object.freeze({
    variable: 'KUMA_URL',
    fallback: 'http://localhost:3001',
    instead: 'put the API key in KUMA_API_KEY',
  }),
  gitea: Object.freeze({
    variable: 'GITEA_URL',
    fallback: null,
    instead: 'put the token in GITEA_TOKEN',
  }),
});

/**
 * The URL a source is read at, or null with none (Gitea unset, or a URL
 * refused), and why it is refused, or null.
 * @param {SourceName} name
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ url: string | null, problem: string | null }}
 */
export function sourceUrl(name, env = process.env) {
  const { variable, fallback, instead } = SOURCE_URLS[name];
  const value = env[variable];
  if (!value) return { url: fallback, problem: null };
  const found = urlCredential(value);
  if (found) {
    return { url: null, problem: `${variable} carries ${whatItCarries(found)}, so it is not used: ${instead}` };
  }
  return { url: value, problem: null };
}

/**
 * Whether the source's variable is set at all, refused or not: a set
 * KUMA_URL or GITEA_URL is something set up (the status model's empty board).
 * @param {SourceName} name
 * @param {Record<string, string | undefined>} [env]
 */
export function sourceUrlSet(name, env = process.env) {
  return Boolean(env[SOURCE_URLS[name].variable]);
}

/**
 * Each source's name and its sourceUrl, in SOURCE_URLS order.
 * @param {Record<string, string | undefined>} env
 */
function each(env) {
  return /** @type {SourceName[]} */ (Object.keys(SOURCE_URLS)).map((name) => ({
    name,
    variable: SOURCE_URLS[name].variable,
    ...sourceUrl(name, env),
  }));
}

/**
 * The refused sources' problems, by source name ({} with none), for the
 * status model.
 * @param {Record<string, string | undefined>} [env]
 * @returns {Record<string, string>}
 */
export function sourceUrlProblems(env = process.env) {
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
export function sourceUrlHealth(env = process.env) {
  /** @type {Record<string, { state: 'refused', variable: string, problem: string }>} */
  const out = {};
  for (const { name, variable, problem } of each(env)) {
    if (problem) out[name] = { state: 'refused', variable, problem };
  }
  return out;
}

/**
 * The boot's one warning per refused source URL, without its value.
 * @param {Record<string, string | undefined>} env
 * @param {{ warn: (fields: object, msg: string) => void }} logger
 */
export function warnRefusedSourceUrls(env, logger) {
  for (const { name, variable, problem } of each(env)) {
    if (problem) logger.warn({ source: name, variable }, problem);
  }
}
