/**
 * Project a raw Arcane response down to the fields the client reads, for
 * recording UAT fixtures. Labels, env, tokens and every other field are dropped.
 *
 * Recorded fixtures are committed to a public repository, so what is kept is also
 * anonymized (createAnonymizer): container names, image references, tags, digests
 * and every id become placeholders, and error text is redacted. The shapes the
 * code depends on are kept: a leading "/" on a name, tag vs digest form, "latest" vs
 * a version-shaped tag, an empty latestVersion, equal vs different digests (and so
 * their 19-character prefixes), the local environment's id "0", UUID-shaped edge ids.
 * Environment names and the Arcane version are public and kept as they are.
 */
import { createHash } from 'crypto';

const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj && k in obj) out[k] = obj[k];
  return out;
};

const pad2 = (n) => String(n).padStart(2, '0');
const SEMVER_SHAPED = /^(v?)\d+(\.\d+)*$/;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HAS_UUID = new RegExp(UUID_SOURCE, 'i');
const ALL_UUIDS = new RegExp(UUID_SOURCE, 'gi');
const fakeUuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
// Placeholder digests come from a counter, never from the real value: a hash of a real
// digest could be reversed by hashing the public digests of candidate images.
const fakeDigest = (n) =>
  'sha256:' + createHash('sha256').update(`arcane-fixture-digest-${n}`).digest('hex');

/**
 * Stable placeholders, numbered by first appearance. Use one instance for every file
 * of a recording so a value maps the same way in all of them: equal stays equal,
 * different stays different.
 */
export function createAnonymizer() {
  const maps = {
    name: new Map(),
    repo: new Map(),
    semver: new Map(),
    otherTag: new Map(),
    digest: new Map(),
    uuid: new Map(), // environment ids and every UUID inside an id: one fake per real value
    otherId: new Map(),
    numId: new Map(),
  };
  const next = (map, real, make) => {
    if (!map.has(real)) map.set(real, make(map.size + 1));
    return map.get(real);
  };

  const digest = (d) => (typeof d === 'string' && d ? next(maps.digest, d, fakeDigest) : d);

  function tag(t) {
    if (typeof t !== 'string' || !t || t === 'latest') return t;
    const m = SEMVER_SHAPED.exec(t);
    if (m) return next(maps.semver, t, (i) => `${m[1]}1.0.${i - 1}`);
    return next(maps.otherTag, t, (i) => `tag-${pad2(i)}`);
  }

  function name(n) {
    if (typeof n !== 'string' || !n) return n;
    const slash = n.startsWith('/') ? '/' : '';
    return slash + next(maps.name, n.slice(slash.length), (i) => `ctr-${pad2(i)}`);
  }

  /** repo[:tag] | repo@digest | a bare image id (sha256:...). */
  function image(ref) {
    if (typeof ref !== 'string' || !ref) return ref;
    if (/^sha256:/.test(ref)) return digest(ref);
    const repoOf = (r) => `registry.example/${next(maps.repo, r, (i) => `img-${pad2(i)}`)}`;
    const at = ref.indexOf('@');
    if (at >= 0) return `${repoOf(ref.slice(0, at))}@${digest(ref.slice(at + 1))}`;
    const colon = ref.lastIndexOf(':');
    if (colon > ref.lastIndexOf('/'))
      return `${repoOf(ref.slice(0, colon))}:${tag(ref.slice(colon + 1))}`;
    return repoOf(ref);
  }

  const uuid = (u) => next(maps.uuid, u.toLowerCase(), fakeUuid);

  /** The local environment keeps "0"; any other environment id becomes a fake UUID. */
  function envId(v) {
    if (v === '0' || v == null || v === '') return v;
    return uuid(String(v));
  }

  /**
   * An activity, batch or history id. Each UUID inside it becomes a fake UUID and the
   * rest is kept, so a shape like image-check-<uuid>-1 survives and an id still matches
   * its batch or a job run's domainActivityId. An id without a UUID becomes id-NN.
   * Empty stays empty (an unlinked job run).
   */
  function id(v) {
    if (typeof v === 'number' && Number.isFinite(v)) return next(maps.numId, v, (i) => i);
    if (typeof v !== 'string' || !v) return v;
    if (HAS_UUID.test(v)) return v.replace(ALL_UUIDS, uuid);
    return next(maps.otherId, v, (i) => `id-${pad2(i)}`);
  }

  return { name, image, tag, digest, envId, id };
}

// Whether something errored is read; the text (registry hosts, usernames) is not.
const redact = (out, src) => {
  if (src && 'error' in src) out.error = src.error ? 'redacted' : '';
};

const imageMap = (m, anon) => {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const out = {};
  for (const [k, v] of Object.entries(m)) if (typeof v === 'string') out[k] = anon.image(v);
  return out;
};

const ROW = {
  environments: (r, anon) => {
    const out = pick(r, ['id', 'name', 'status', 'enabled']);
    if ('id' in out) out.id = anon.envId(out.id);
    return out;
  },
  containers: (r, anon) => {
    const out = pick(r, ['names', 'image', 'autoUpdateEnabled']);
    if (Array.isArray(out.names)) out.names = out.names.map(anon.name);
    if ('image' in out) out.image = anon.image(out.image);
    if (r?.updateInfo && typeof r.updateInfo === 'object') {
      const info = pick(r.updateInfo, [
        'hasUpdate',
        'currentVersion',
        'latestVersion',
        'currentDigest',
        'latestDigest',
      ]);
      for (const k of ['currentVersion', 'latestVersion'])
        if (k in info) info[k] = anon.tag(info[k]);
      for (const k of ['currentDigest', 'latestDigest'])
        if (k in info) info[k] = anon.digest(info[k]);
      redact(info, r.updateInfo);
      out.updateInfo = info;
    }
    return out;
  },
  activities: (r, anon) => {
    const out = pick(r, ['id', 'type', 'status', 'startedAt', 'endedAt', 'batchId']);
    for (const k of ['id', 'batchId']) if (k in out) out[k] = anon.id(out[k]);
    redact(out, r);
    // Only the job-run link the poller reads (runOrigin); other metadata is dropped.
    const md = r?.metadata;
    if (md && typeof md === 'object' && !Array.isArray(md)) {
      const link = {};
      if (typeof md.trigger === 'string') link.trigger = md.trigger;
      if (typeof md.domainActivityId === 'string') {
        link.domainActivityId = anon.id(md.domainActivityId);
      }
      if (Object.keys(link).length) out.metadata = link;
    }
    return out;
  },
  history: (r, anon) => {
    const out = pick(r, ['id', 'createdAt', 'resourceName', 'status']);
    if ('id' in out) out.id = anon.id(out.id);
    if ('resourceName' in out) out.resourceName = anon.name(out.resourceName);
    redact(out, r);
    if ('oldImageVersions' in (r || {})) out.oldImageVersions = imageMap(r.oldImageVersions, anon);
    if ('newImageVersions' in (r || {})) out.newImageVersions = imageMap(r.newImageVersions, anon);
    return out;
  },
};

const VERSION_KEYS = ['currentVersion', 'newestVersion', 'updateAvailable', 'releaseUrl'];

/**
 * kind: environments | containers | activities | history | app-version. Pass one
 * anonymizer for every file of a recording; the default is a fresh one per call.
 */
export function projectFixture(kind, body, anon = createAnonymizer()) {
  if (kind === 'app-version') {
    const data = body && typeof body === 'object' && 'success' in body ? body.data : body;
    return pick(data, VERSION_KEYS);
  }
  const row = ROW[kind];
  if (!row) throw new Error(`unknown fixture kind: ${kind}`);
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body.data : body;
  return { success: true, data: Array.isArray(data) ? data.map((r) => row(r, anon)) : [] };
}
