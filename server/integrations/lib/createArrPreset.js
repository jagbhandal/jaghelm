/**
 * Factory for the *arr-family presets (Radarr, Sonarr, Lidarr, Readarr,
 * Prowlarr, Bazarr).
 *
 * They share a near-identical shape: header auth with `X-Api-Key`, an
 * `/api/{apiVersion}/...` data endpoint, a `system/status` test endpoint, and
 * a single numeric field pulled from the response. This factory collapses that
 * shared shape into one place so adding a new *arr is a one-liner.
 *
 * The EMITTED object is intentionally byte-identical to the hand-written
 * presets it replaces — same keys, same order (name, icon, description, auth,
 * authHeader, endpoint, testEndpoint, fields, envKeys). Anything that diverges
 * from the common queue shape (Prowlarr's indexer list, Bazarr's versionless
 * paths) is passed in explicitly via the override params below.
 *
 * @param {object}  opts
 * @param {string}  opts.name         Display name (e.g. 'Radarr').
 * @param {string}  opts.icon         Icon key (e.g. 'radarr').
 * @param {string}  opts.description  Gallery description.
 * @param {string} [opts.apiVersion]  API version segment ('v3', 'v1', …). Used
 *                                     to build the default endpoints. Omit when
 *                                     the service has no version segment and you
 *                                     supply `endpoint`/`testEndpoint` directly
 *                                     (Bazarr).
 * @param {string}  opts.envPrefix    Env-var prefix (e.g. 'RADARR'). Produces
 *                                     `{PREFIX}_URL` + `{PREFIX}_API_KEY`.
 * @param {string} [opts.endpoint]    Override the default data endpoint
 *                                     (`/api/{apiVersion}/queue?pageSize=1`).
 * @param {string} [opts.testEndpoint] Override the default test endpoint
 *                                     (`/api/{apiVersion}/system/status`).
 * @param {Array}  [opts.fields]      Override the default fields array
 *                                     (`[{ key:'queued', label:'Queued',
 *                                     path:'totalRecords', format:'number' }]`).
 * @returns {object} A preset config object ready for default-export.
 */
export function createArrPreset({
  name,
  icon,
  description,
  apiVersion,
  envPrefix,
  endpoint = `/api/${apiVersion}/queue?pageSize=1`,
  testEndpoint = `/api/${apiVersion}/system/status`,
  fields = [
    { key: 'queued', label: 'Queued', path: 'totalRecords', format: 'number' },
  ],
}) {
  return {
    name,
    icon,
    description,
    auth: 'header',
    authHeader: 'X-Api-Key',
    endpoint,
    testEndpoint,
    fields,
    envKeys: {
      url: `${envPrefix}_URL`,
      token: `${envPrefix}_API_KEY`,
    },
  };
}
