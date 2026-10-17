/**
 * Project a raw Arcane response down to the fields the client reads, for
 * recording UAT fixtures. Labels, env, tokens and every other field are dropped.
 */
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && k in obj) out[k] = obj[k];
  return out;
};

const stringMap = (m) => {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === 'string') out[k] = v;
  return out;
};

const ROW = {
  environments: (r) => pick(r, ['id', 'name', 'status', 'enabled']),
  containers: (r) => {
    const out = pick(r, ['names', 'image', 'autoUpdateEnabled']);
    if (r?.updateInfo && typeof r.updateInfo === 'object') {
      out.updateInfo = pick(r.updateInfo, [
        'hasUpdate',
        'currentVersion',
        'latestVersion',
        'currentDigest',
        'latestDigest',
      ]);
    }
    return out;
  },
  activities: (r) => pick(r, ['id', 'type', 'status', 'startedAt', 'endedAt', 'error']),
  history: (r) => {
    const out = pick(r, ['id', 'createdAt', 'resourceName', 'status', 'error']);
    if ('oldImageVersions' in (r || {})) out.oldImageVersions = stringMap(r.oldImageVersions);
    if ('newImageVersions' in (r || {})) out.newImageVersions = stringMap(r.newImageVersions);
    return out;
  },
};

const VERSION_KEYS = ['currentVersion', 'newestVersion', 'updateAvailable', 'releaseUrl'];

/** kind: environments | containers | activities | history | app-version. */
export function projectFixture(kind, body) {
  if (kind === 'app-version') {
    const data = body && typeof body === 'object' && 'success' in body ? body.data : body;
    return pick(data, VERSION_KEYS);
  }
  const row = ROW[kind];
  if (!row) throw new Error(`unknown fixture kind: ${kind}`);
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body.data : body;
  return { success: true, data: Array.isArray(data) ? data.map(row) : [] };
}
