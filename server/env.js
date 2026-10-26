// @ts-check
/**
 * The environment JagHelm reads (#249): every variable in one schema, with its
 * type, its default and the old name it still answers to. This is the one
 * module that reads `process.env`; the rest of the server asks it for a
 * variable by name (envValue), and gets the value checked and parsed, or the
 * default. A name the schema doesn't have is a bug, and throws.
 *
 * The boot checks the whole environment once (reportEnv, from index.js). A
 * value that doesn't fit its type is warned once, naming the variable, what it
 * must be and the default used instead, which is the safe side (the CSP
 * enforced, the secrets API closed, no demo). Only a bad PORT or
 * JAGHELM_BLOCK_PRIVATE_NETWORKS stops the start (`refuse`): there is no port
 * to listen on, or a strict SSRF guard was asked for and would not be given.
 * No line ever carries a value, as most of them are addresses, keys or
 * passwords. An empty variable counts as unset, as `X=` lines in a copied
 * env.example are.
 *
 * Names: the integration presets' variables and the Pipeline panel's Gitea
 * pair take the `JAGHELM_` prefix the docs promise (`JAGHELM_SONARR_URL`,
 * `JAGHELM_GITEA_TOKEN`), so they can't pick up another service's variable
 * in a shared env file. Their old unprefixed names (`SONARR_URL`,
 * `GITEA_TOKEN`) still work for one release: the boot warns once for each
 * one set, and when both names are set with different values the `JAGHELM_`
 * one is used, with that warning saying so. The server's own settings keep
 * their names (PROMETHEUS_URL, KUMA_URL, DASH_SECRET, PORT, ARCANE_URL, …).
 *
 * env.example lists every variable here and nothing else
 * (server/env.docs.test.js).
 */
import { z } from 'zod';

/**
 * How a variable's text is read: `text`, `url` and `secret` as they are
 * (`url` is checked for a credential where it is used, sourceUrls.js and
 * integrations/lib/config.js; `secret` is never logged, nor is anything
 * else); `list`, comma-separated, each item trimmed, empty ones dropped;
 * `bool`, true or false in any case; `int`, a whole number (the reader
 * keeps it in its range); `number`, a number above 0; `port`, 0 to 65535;
 * `enum`, one of `values`, in any case.
 * @typedef {'text' | 'url' | 'secret' | 'list' | 'bool' | 'int' | 'number' | 'port' | 'enum'} Kind
 */

/**
 * @typedef {object} EnvVar
 * @property {string} name  the variable's name
 * @property {Kind} kind
 * @property {readonly string[]} legacy  older names it still answers to, for one release
 * @property {unknown} fallback  the value when it is unset or doesn't fit its type
 * @property {readonly string[]} [values]  an `enum`'s values
 * @property {boolean} [refuse]  a value that doesn't fit stops the start (else it is warned, and the default used)
 * @property {boolean} [image]  set by the image, not by an install: not in env.example
 */

/**
 * Every preset's variables (integrations/presets, `envKeys`) without the
 * `JAGHELM_` prefix, by preset (server/env.presets.test.js keeps the two the
 * same). The variable is `JAGHELM_` + the name, and the name alone is its old
 * one, except for the presets in PREFIXED_ONLY, which only ever read the
 * prefixed name. Gitea's two are the Pipeline panel's too.
 */
export const INTEGRATION_VARS = Object.freeze({
  adguard: ['ADGUARD_URL', 'ADGUARD_USER', 'ADGUARD_PASS'],
  authentik: ['AUTHENTIK_URL', 'AUTHENTIK_TOKEN'],
  bazarr: ['BAZARR_URL', 'BAZARR_API_KEY'],
  caddy: ['CADDY_URL'],
  cloudflare: ['CLOUDFLARE_URL', 'CLOUDFLARE_TOKEN'],
  deluge: ['DELUGE_URL', 'DELUGE_PASS'],
  emby: ['EMBY_URL', 'EMBY_API_KEY'],
  frigate: ['FRIGATE_URL'],
  gitea: ['GITEA_URL', 'GITEA_TOKEN'],
  gitlab: ['GITLAB_URL', 'GITLAB_TOKEN'],
  gotify: ['GOTIFY_URL', 'GOTIFY_TOKEN'],
  grafana: ['GRAFANA_URL', 'GRAFANA_TOKEN'],
  homeassistant: ['HASS_URL', 'HASS_TOKEN'],
  immich: ['IMMICH_URL', 'IMMICH_API_KEY'],
  jellyfin: ['JELLYFIN_URL', 'JELLYFIN_API_KEY'],
  lidarr: ['LIDARR_URL', 'LIDARR_API_KEY'],
  mealie: ['MEALIE_URL', 'MEALIE_TOKEN'],
  nextdns: ['NEXTDNS_URL', 'NEXTDNS_API_KEY'],
  npm: ['NPM_URL', 'NPM_USER', 'NPM_PASS'],
  ntfy: ['NTFY_URL'],
  nzbget: ['NZBGET_URL', 'NZBGET_USER', 'NZBGET_PASS'],
  overseerr: ['OVERSEERR_URL', 'OVERSEERR_API_KEY'],
  paperless: ['PAPERLESS_URL', 'PAPERLESS_TOKEN'],
  photoprism: ['PHOTOPRISM_URL', 'PHOTOPRISM_USER', 'PHOTOPRISM_PASS'],
  pihole: ['PIHOLE_URL', 'PIHOLE_APP_PASSWORD'],
  plex: ['PLEX_URL', 'PLEX_TOKEN'],
  portainer: ['PORTAINER_URL', 'PORTAINER_USER', 'PORTAINER_PASS'],
  prowlarr: ['PROWLARR_URL', 'PROWLARR_API_KEY'],
  proxmox: ['PROXMOX_URL', 'PROXMOX_TOKEN'],
  qbittorrent: ['QBITTORRENT_URL', 'QBITTORRENT_USER', 'QBITTORRENT_PASS'],
  radarr: ['RADARR_URL', 'RADARR_API_KEY'],
  readarr: ['READARR_URL', 'READARR_API_KEY'],
  sabnzbd: ['SABNZBD_URL', 'SABNZBD_API_KEY'],
  sonarr: ['SONARR_URL', 'SONARR_API_KEY'],
  speedtest: ['SPEEDTEST_URL'],
  tailscale: ['TAILSCALE_URL', 'TAILSCALE_API_KEY'],
  tautulli: ['TAUTULLI_URL', 'TAUTULLI_API_KEY'],
  traefik: ['TRAEFIK_URL'],
  transmission: ['TRANSMISSION_URL', 'TRANSMISSION_USER', 'TRANSMISSION_PASS'],
  vaultwarden: ['VAULTWARDEN_URL'],
});

/** The presets whose variables were always prefixed: they have no old name. */
const PREFIXED_ONLY = new Set(['adguard', 'cloudflare', 'photoprism']);

/** The levels LOG_LEVEL takes (util/logger.js). */
export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warn', 'error', 'silent']);

/** The demo's fixture sets (demo.js, DEMO_SCENARIO). */
export const DEMO_SCENARIOS = Object.freeze(['incident', 'healthy']);

/** The address the server listens on when JAGHELM_HOST is unset: every IPv4 interface. */
export const DEFAULT_BIND_HOST = '0.0.0.0';

/**
 * @param {string} name
 * @param {Kind} kind
 * @param {{ legacy?: string[], fallback?: unknown, values?: readonly string[], refuse?: boolean, image?: boolean }} [opts]
 * @returns {EnvVar}
 */
function v(name, kind, { legacy = [], fallback, values, refuse, image } = {}) {
  const unset = kind === 'list' ? [] : kind === 'bool' ? false : '';
  return Object.freeze({
    name,
    kind,
    legacy: Object.freeze(legacy),
    fallback: fallback === undefined ? unset : fallback,
    ...(values && { values }),
    ...(refuse && { refuse }),
    ...(image && { image }),
  });
}

/** The integration variables, in INTEGRATION_VARS order, but Gitea's (declared with the sources). */
function integrationVars() {
  /** @type {EnvVar[]} */
  const out = [];
  for (const [preset, names] of Object.entries(INTEGRATION_VARS)) {
    if (preset === 'gitea') continue;
    for (const base of names) {
      const kind = base.endsWith('_URL') ? 'url' : base.endsWith('_USER') ? 'text' : 'secret';
      out.push(v(`JAGHELM_${base}`, kind, { legacy: PREFIXED_ONLY.has(preset) ? [] : [base] }));
    }
  }
  return out;
}

/** The schema: every variable JagHelm reads. */
export const ENV_SCHEMA = Object.freeze([
  // The monitoring sources (sourceUrls.js) and the UPS (refresh.js).
  v('PROMETHEUS_URL', 'url'),
  v('KUMA_URL', 'url'),
  v('LOKI_URL', 'url'),
  v('KUMA_API_KEY', 'secret'),
  v('JAGHELM_GITEA_URL', 'url', { legacy: ['GITEA_URL'] }),
  v('JAGHELM_GITEA_TOKEN', 'secret', { legacy: ['GITEA_TOKEN'] }),
  v('JAGHELM_UPS_NAME', 'text'),
  // The expiry tracker's Tailscale node keys (tailscaleExpiry.js, #676) read the
  // Tailscale integration's JAGHELM_TAILSCALE_API_KEY (declared with the integrations);
  // this names the tailnet, "-" (the token's own) when unset.
  v('JAGHELM_TAILNET', 'text'),
  // The Backups section's bucket size (b2.js, #675): a read-only B2 application key
  // restricted to the bucket. All three, or that part is absent.
  v('JAGHELM_B2_KEY_ID', 'text'),
  v('JAGHELM_B2_APP_KEY', 'secret'),
  v('JAGHELM_B2_BUCKET', 'text'),
  // Arcane (arcane/config.js).
  v('ARCANE_URL', 'url'),
  v('ARCANE_API_KEY', 'secret'),
  v('ARCANE_CHECK_ONLY_ENVS', 'list'),
  v('ARCANE_POLL_SECONDS', 'int', { fallback: 300 }),
  v('ARCANE_RELEASE_CHECK_HOURS', 'int', { fallback: 6 }),
  v('ARCANE_IMAGE_CHECK_HOURS', 'int', { fallback: 6 }),
  v('ARCANE_VULN_DIGEST_ENVS', 'list'),
  v('ARCANE_VULN_DIGEST_DAY', 'int', { fallback: 0 }),
  v('ARCANE_VULN_DIGEST_HOUR', 'int', { fallback: 14 }),
  // Read by Node itself, at start.
  v('NODE_EXTRA_CA_CERTS', 'text'),
  // Secrets and sign-in.
  v('DASH_SECRET', 'secret'),
  v('PORT', 'port', { fallback: 3099, refuse: true }),
  v('JAGHELM_HOST', 'text', { fallback: DEFAULT_BIND_HOST }),
  v('DASH_USER', 'text', { fallback: 'admin' }),
  v('DASH_PASS', 'secret'),
  v('JAGHELM_CRON_SECRET', 'secret'),
  v('JAGHELM_ALLOW_OPEN_SECRETS', 'bool'),
  v('LOG_LEVEL', 'enum', { values: LOG_LEVELS, fallback: 'info' }),
  // Storage.
  v('JAGHELM_DATA_DIR', 'text'),
  v('JAGHELM_ICON_CACHE_MAX_MB', 'number', { fallback: 50 }),
  // Web Push to the installed dashboard (push/webPush.js, #653): the VAPID key
  // pair and a contact. Optional (#698): with both keys unset JagHelm makes and
  // keeps its own pair; one key without the other leaves Web Push off; the
  // subject defaults to the project's page.
  v('VAPID_PUBLIC_KEY', 'text'),
  v('VAPID_PRIVATE_KEY', 'secret'),
  v('VAPID_SUBJECT', 'text'),
  // The integrations' own variables (integrations/lib/config.js).
  ...integrationVars(),
  // HTTP.
  v('TRUST_PROXY', 'list'),
  // Sign-in (auth/rateLimit.js): kept as written; loginAddress.js checks each entry.
  v('LOGIN_TRUSTED_NETS', 'text'),
  v('CORS_ORIGIN', 'list'),
  v('JAGHELM_BLOCK_PRIVATE_NETWORKS', 'bool', { refuse: true }),
  v('CSP_REPORT_ONLY', 'bool'),
  v('CSP_CONNECT_EXTRA', 'list'),
  // How long things count as present or fresh.
  v('JAGHELM_CONTAINER_STALE_SEC', 'number', { fallback: 90 }),
  v('JAGHELM_MONITOR_STALE_MS', 'number', { fallback: 10 * 60 * 1000 }),
  v('JAGHELM_PRESENCE_GRACE_MS', 'number', { fallback: 90_000 }),
  v('JAGHELM_PRESENCE_TTL_MS', 'number', { fallback: 86_400_000 }),
  v('JAGHELM_PRESENCE_ESTABLISH_MS', 'number', { fallback: 60_000 }),
  // The read-only demo (demo.js).
  v('DEMO_MODE', 'bool'),
  v('DEMO_SCENARIO', 'enum', { values: DEMO_SCENARIOS, fallback: 'incident' }),
  // The image's build commit (Dockerfile), for /api/health.
  v('JAGHELM_REVISION', 'text', { image: true }),
]);

/** @type {Map<string, EnvVar>} */
const BY_NAME = new Map(ENV_SCHEMA.map((d) => [d.name, d]));

/** Every old name, to the variable it stands for. */
export const LEGACY_NAMES = Object.freeze(
  Object.fromEntries(ENV_SCHEMA.flatMap((d) => d.legacy.map((old) => [old, d.name])))
);

const trimmed = z.string().trim();
const whole = trimmed.regex(/^-?\d+$/).transform(Number).pipe(z.number().int().safe());

/**
 * Each kind's parser, and what its value must be, for the boot's line.
 * @type {Record<Kind, (d: EnvVar) => { schema: z.ZodType, must: string }>}
 */
const KINDS = {
  text: () => ({ schema: z.string(), must: '' }),
  url: () => ({ schema: z.string(), must: '' }),
  secret: () => ({ schema: z.string(), must: '' }),
  list: () => ({
    schema: z.string().transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
    must: '',
  }),
  bool: () => ({
    schema: trimmed.toLowerCase().pipe(z.enum(['true', 'false'])).transform((s) => s === 'true'),
    must: 'must be true or false',
  }),
  int: () => ({ schema: whole, must: 'must be a whole number' }),
  number: () => ({ schema: trimmed.transform(Number).pipe(z.number().positive()), must: 'must be a number above 0' }),
  port: () => ({
    schema: trimmed.regex(/^\d+$/).transform(Number).pipe(z.number().int().max(65535)),
    must: 'must be a port number from 0 to 65535',
  }),
  enum: (d) => ({
    schema: trimmed.toLowerCase().pipe(z.enum(/** @type {[string, ...string[]]} */ ([...(d.values ?? [])]))),
    must: `must be one of ${(d.values ?? []).join(', ')}`,
  }),
};

/** @type {Map<string, { schema: z.ZodType, must: string }>} */
const PARSERS = new Map(ENV_SCHEMA.map((d) => [d.name, KINDS[d.kind](d)]));

/**
 * The declaration of `name`, which must be in the schema.
 * @param {string} name
 */
function declared(name) {
  const d = BY_NAME.get(name);
  if (!d) throw new Error(`${name} is not in the environment schema (server/env.js)`);
  return d;
}

/** @typedef {Record<string, string | undefined>} RawEnv */

/**
 * The variable's text and the name it was read from: its own name first,
 * then its old ones. Empty is unset.
 * @param {EnvVar} d
 * @param {RawEnv} raw
 */
function lookup(d, raw) {
  for (const name of [d.name, ...d.legacy]) {
    const text = raw[name];
    if (text !== undefined && text !== '') return { text, from: name };
  }
  return { text: undefined, from: null };
}

/**
 * One variable as read from `raw` (the process's environment by default):
 * its value (the default when it is unset or doesn't fit its type), the name
 * it was read from (null when unset), and what is wrong with it (null when
 * nothing is).
 * @param {string} name
 * @param {RawEnv} [raw]
 * @returns {{ value: any, from: string | null, problem: string | null }}
 */
export function readEnv(name, raw = process.env) {
  const d = declared(name);
  const { text, from } = lookup(d, raw);
  if (text === undefined) return { value: d.fallback, from: null, problem: null };
  const parser = /** @type {{ schema: z.ZodType, must: string }} */ (PARSERS.get(d.name));
  const parsed = parser.schema.safeParse(text);
  if (parsed.success) return { value: parsed.data, from, problem: null };
  return { value: d.fallback, from, problem: `${from} ${parser.must}` };
}

/**
 * A variable's value: as its type reads it, or its default when it is unset.
 * `raw` is the process's environment unless a test passes its own.
 * @param {string} name
 * @param {RawEnv} [raw]
 * @returns {any}
 */
export function envValue(name, raw) {
  return readEnv(name, raw).value;
}

/**
 * The name a variable was read from, its own or an old one, or null when it is
 * unset: what a message about its value names, so it matches the user's file.
 * @param {string} name
 * @param {RawEnv} [raw]
 */
export function envFrom(name, raw) {
  return readEnv(name, raw).from;
}

/**
 * The whole environment checked: `problems`, one per variable whose value
 * doesn't fit its type ({ variable, message, refuse, fallback }: whether it
 * stops the start, and the default used instead), and `notices`, one per old
 * name that is set ({ variable, use, message }). Neither carries a value.
 * @param {RawEnv} [raw]
 */
export function checkEnv(raw = process.env) {
  /** @type {{ variable: string, message: string, refuse: boolean, fallback: unknown }[]} */
  const problems = [];
  /** @type {{ variable: string, use: string, message: string }[]} */
  const notices = [];
  for (const d of ENV_SCHEMA) {
    const { from, problem } = readEnv(d.name, raw);
    if (problem && from) {
      problems.push({ variable: from, message: problem, refuse: Boolean(d.refuse), fallback: d.fallback });
    }
    for (const old of d.legacy) {
      const text = raw[old];
      if (text === undefined || text === '') continue;
      const own = raw[d.name];
      const differs = own !== undefined && own !== '' && own !== text;
      notices.push({
        variable: old,
        use: d.name,
        message: differs
          ? `${old} and ${d.name} are both set and differ: using ${d.name}. Remove ${old}, which is deprecated`
          : `${old} is deprecated: rename it to ${d.name}. A later release reads only ${d.name}`,
      });
    }
  }
  return { problems, notices };
}

// The old names and the invalid variables already warned about, so a second
// report doesn't repeat one.
const warnedOld = new Set();
const warnedInvalid = new Set();

/**
 * The boot's check of the environment (index.js): one warning per old name
 * set and one per variable whose value doesn't fit (the default is used),
 * once per process each, and an error line per invalid variable that refuses
 * (PORT, JAGHELM_BLOCK_PRIVATE_NETWORKS). Returns whether the server can
 * start: false when one of those is invalid.
 * @param {{ warn: (fields: object, msg: string) => void, error: (fields: object, msg: string) => void }} logger
 * @param {RawEnv} [raw]
 */
export function reportEnv(logger, raw = process.env) {
  const { problems, notices } = checkEnv(raw);
  for (const { variable, use, message } of notices) {
    if (warnedOld.has(variable)) continue;
    warnedOld.add(variable);
    logger.warn({ variable, use }, message);
  }
  let refused = false;
  for (const { variable, message, refuse, fallback } of problems) {
    if (refuse) {
      refused = true;
      logger.error({ variable }, `${message}: JagHelm won't start until it is fixed`);
    } else if (!warnedInvalid.has(variable)) {
      warnedInvalid.add(variable);
      logger.warn({ variable }, `${message}: using the default, ${fallback}`);
    }
  }
  return !refused;
}

/**
 * The address to listen on: JAGHELM_HOST, trimmed, or {@link DEFAULT_BIND_HOST}
 * when it is unset or blank. Not validated here: a wrong address makes listen()
 * fail, and the server exits saying so (server/index.js).
 * @param {RawEnv} [raw]
 */
export function resolveBindHost(raw) {
  return String(envValue('JAGHELM_HOST', raw)).trim() || DEFAULT_BIND_HOST;
}
