/**
 * Pure derivation for the weekly vulnerability digest, from Arcane v2.16.1 rows.
 * No clock (the caller passes nowMs), no I/O.
 *
 * A finding is keyed by (image repository without tag or digest, vulnerability id,
 * package), critical and high fixable only. The repository, not the image id, is
 * the key so an image update that keeps a finding is not news. The id and package
 * are kept only as a short hash (findingHash, #581 review): the state is written
 * with every push, and a host's few thousand findings would otherwise make it
 * hundreds of KB. The repository stays whole, as the digest carries an uncertain
 * repository's findings forward by it.
 */
import { createHash } from 'node:crypto';

// A running image whose latest scan is older than this has a scan health problem.
export const STALE_SCAN_MS = 9 * 86_400_000;

const SEVERITY_CODE = { CRITICAL: 'C', HIGH: 'H' };
const MAX_FIELD = 256;
const TOP_IMAGES = 3;
// An image id, e.g. an untagged image Arcane scanned by id (scan/service.go:184).
const IMAGE_ID_RE = /^sha256:[0-9a-f]+$/i;

const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The repository part of an image reference: tag and digest dropped, Docker Hub's
 * implicit `docker.io/` and `library/` removed, lower case. An image id stays as it is.
 * '' when the reference is not a usable string.
 */
export function imageRepo(ref) {
  let r = str(ref).trim();
  if (!r) return '';
  if (IMAGE_ID_RE.test(r)) return r.toLowerCase();
  const at = r.indexOf('@');
  if (at >= 0) r = r.slice(0, at);
  // A tag is a ':' after the last '/'; an earlier one is a registry port.
  const colon = r.lastIndexOf(':');
  if (colon > r.lastIndexOf('/')) r = r.slice(0, colon);
  r = r.toLowerCase();
  for (const hub of ['docker.io/', 'index.docker.io/']) {
    if (r.startsWith(hub)) r = r.slice(hub.length);
  }
  if (r.startsWith('library/') && r.split('/').length === 2) r = r.slice('library/'.length);
  return r.slice(0, MAX_FIELD);
}

/** Short name for a push: the repository's last path segment, or 12 hex digits of an id. */
export function displayName(repo) {
  if (IMAGE_ID_RE.test(repo)) return repo.slice('sha256:'.length, 'sha256:'.length + 12);
  return repo.slice(repo.lastIndexOf('/') + 1);
}

/** Characters of findingHash: 60 bits, so two findings of one repository practically never share one. */
export const HASH_LENGTH = 10;
const HASH_RE = new RegExp(`^[A-Za-z0-9_-]{${HASH_LENGTH}}$`);

/** A finding's vulnerability id and package as HASH_LENGTH base64url characters of their SHA-256. */
export function findingHash(id, pkg) {
  return createHash('sha256').update(JSON.stringify([id, pkg])).digest('base64url').slice(0, HASH_LENGTH);
}

/** Whether `v` is a findingHash. */
export const isFindingHash = (v) => typeof v === 'string' && HASH_RE.test(v);

/** The state key of a finding by its repository and findingHash. JSON keeps the parts unambiguous. */
export function hashKey(repo, hash) {
  return JSON.stringify([repo, hash]);
}

/** The state key of one finding. */
export function findingKey(repo, id, pkg) {
  return hashKey(repo, findingHash(id, pkg));
}

/**
 * Critical and high fixable findings from `GET …/vulnerabilities/all` rows
 * (types/vulnerability VulnerabilityWithImage), as key -> { repo, id, pkg, sev },
 * sorted by key. sev is 'C' or 'H'; a key seen at both takes 'C'. Rows the request
 * should already have filtered out (other severities, no fixed version) are dropped
 * here too, and so is anything malformed. With `imageIds`, only rows of those images
 * count: the digest passes the images its containers use, the same images whose scans
 * scanHealth tracks, so an unused image's rescan can never read as fixed and then new.
 */
export function currentFindings(rows, { imageIds } = {}) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isObj(row)) continue;
    if (imageIds && !imageIds.has(str(row.imageId))) continue;
    const sev = SEVERITY_CODE[row.severity];
    const repo = imageRepo(row.imageName);
    const id = str(row.vulnerabilityId).slice(0, MAX_FIELD);
    const pkg = str(row.pkgName).slice(0, MAX_FIELD);
    if (!sev || !repo || !id || !pkg || !str(row.fixedVersion)) continue;
    const key = findingKey(repo, id, pkg);
    const prev = out.get(key);
    if (!prev || (prev.sev === 'H' && sev === 'C')) out.set(key, { repo, id, pkg, sev });
  }
  return new Map([...out].sort(([a], [b]) => cmpStr(a, b)));
}

/** image id -> { repo, running, createdMs (newest container, or NaN) } from the container list. */
function containerImages(containers) {
  const images = new Map();
  for (const c of Array.isArray(containers) ? containers : []) {
    const imageId = str(c?.imageId);
    if (!imageId) continue;
    const repo = imageRepo(c.image) || imageRepo(imageId);
    const rec = images.get(imageId) || { repo, running: false, createdMs: NaN };
    if (c.state === 'running') rec.running = true;
    // Container `created` is unix seconds (types/container/container.go:899).
    const created = Number.isFinite(c.created) ? c.created * 1000 : NaN;
    if (!(rec.createdMs >= created)) rec.createdMs = created;
    images.set(imageId, rec);
  }
  return images;
}

const summaryOf = (sums, imageId) =>
  isObj(sums) && Object.hasOwn(sums, imageId) && isObj(sums[imageId]) ? sums[imageId] : null;

/**
 * Scan health from the container list and `POST …/images/vulnerabilities/summaries`
 * (image id -> ScanSummary { status, scanTime, … }):
 *   stale     - running images whose latest completed scan is older than STALE_SCAN_MS,
 *               or that have no scan while their newest container is older than that
 *               (a container just recreated on a new image waits for the next scan);
 *   failed    - running images whose latest scan failed;
 *   uncertain - repositories with an image (any container state) whose latest scan is not
 *               a completed one (none, failed, pending, scanning). Arcane lists findings
 *               only from completed scans (query/service.go scanItemsQueryInternal), so
 *               such a repository's earlier findings are not "fixed", only unseen;
 *   scannedAny - whether any container image has a scan record at all.
 * A scan in progress is neither stale nor failed: Arcane fails one that runs too long.
 */
export function scanHealth({ containers, summaries, nowMs }) {
  const stale = new Set();
  const failed = new Set();
  const uncertain = new Set();
  let scannedAny = false;
  for (const [imageId, { repo, running, createdMs }] of containerImages(containers)) {
    const s = summaryOf(summaries, imageId);
    if (s) scannedAny = true;
    const status = s ? str(s.status) : 'none';
    if (status !== 'completed' && repo) uncertain.add(repo);
    if (!running || !repo) continue;
    const name = displayName(repo);
    if (status === 'failed') failed.add(name);
    else if (status === 'none') {
      if (nowMs - createdMs > STALE_SCAN_MS) stale.add(name);
    } else if (status === 'completed') {
      const age = nowMs - Date.parse(str(s.scanTime));
      if (!(age <= STALE_SCAN_MS)) stale.add(name);
    }
  }
  return {
    stale: [...stale].sort(cmpStr),
    failed: [...failed].sort(cmpStr),
    uncertain,
    scannedAny,
  };
}

/**
 * Repositories whose image scan changed between two summary reads (status or scan time
 * differ, or a record appeared or went), or is not completed in the second read. The
 * digest reads summaries before and after the findings, so a scan that started while the
 * findings were read (Arcane replaces an image's findings when it rescans) is uncertain.
 */
export function rescannedRepos({ containers, before, after }) {
  const out = new Set();
  for (const [imageId, { repo }] of containerImages(containers)) {
    if (!repo) continue;
    const a = summaryOf(before, imageId);
    const b = summaryOf(after, imageId);
    const changed = !a !== !b || (a && (a.status !== b.status || a.scanTime !== b.scanTime));
    if (changed || str(b?.status) !== 'completed') out.add(repo);
  }
  return out;
}

/**
 * The KEV count to store. An unknown count (threat intel off) keeps the last one. While a
 * repository is uncertain the count is never lowered: a failed scan drops that image's
 * findings from Arcane's overview too, and the entry coming back would read as new.
 */
export function nextKev({ kev, prevKev, uncertain }) {
  const k = Number.isInteger(kev) ? kev : prevKev;
  if (!Number.isInteger(k)) return null;
  return uncertain && Number.isInteger(prevKev) ? Math.max(k, prevKev) : k;
}

/**
 * What changed since the last digest. added: current keys not seen before. fixed: keys
 * gone whose repository is not uncertain. next: the key set to store, i.e. the current
 * keys plus the previous keys of uncertain repositories (carried until a completed scan
 * says otherwise, so a failed scan never reads as "fixed" and then "new").
 */
export function diffFindings({ prev, current, uncertain }) {
  const added = [];
  for (const [key, e] of current) if (!prev.has(key)) added.push(e);
  const fixed = [];
  const next = new Map(current);
  for (const [key, e] of prev) {
    if (current.has(key)) continue;
    if (uncertain.has(e.repo)) next.set(key, e);
    else fixed.push(e);
  }
  return { added, fixed, next: new Map([...next].sort(([a], [b]) => cmpStr(a, b))) };
}

/**
 * Unique CVEs in the CISA KEV catalog among the environment's findings
 * (RiskOverview.drivers.knownExploited), or null when threat intel is off or the
 * count is malformed.
 */
export function kevCount(overview) {
  if (!isObj(overview) || overview.threatIntel?.enabled !== true) return null;
  const n = overview.drivers?.knownExploited;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The digest for one environment. It pushes only when something is new: a new critical
 * or high finding, more KEV entries than at the last digest, or an image newly stale or
 * failed (not in either list at the last digest). Fixed findings and scan problems that
 * were already reported are listed only in a push sent anyway; recovery never pushes.
 * Warning for a new critical or a new KEV entry, info otherwise.
 */
export function buildDigest({ added, fixed, kev, prevKev, health, prevHealth }) {
  let newCritical = 0;
  let newHigh = 0;
  const byRepo = new Map();
  for (const e of added) {
    const rec = byRepo.get(e.repo) || { name: displayName(e.repo), critical: 0, high: 0 };
    if (e.sev === 'C') {
      newCritical += 1;
      rec.critical += 1;
    } else {
      newHigh += 1;
      rec.high += 1;
    }
    byRepo.set(e.repo, rec);
  }
  const top = [...byRepo.values()]
    .sort((a, b) => b.critical - a.critical || b.high - a.high || cmpStr(a.name, b.name))
    .slice(0, TOP_IMAGES);
  const kevNew =
    Number.isInteger(kev) && Number.isInteger(prevKev) && kev > prevKev ? kev - prevKev : 0;
  const known = new Set([...(prevHealth?.stale ?? []), ...(prevHealth?.failed ?? [])]);
  const sorted = (list, keep) => list.filter((n) => known.has(n) === keep).sort(cmpStr);
  const stale = sorted(health.stale, false);
  const failed = sorted(health.failed, false);
  return {
    newCritical,
    newHigh,
    images: byRepo.size,
    top,
    kev: Number.isInteger(kev) ? kev : null,
    kevNew,
    fixed: fixed.length,
    stale,
    failed,
    stillStale: sorted(health.stale, true),
    stillFailed: sorted(health.failed, true),
    push: added.length > 0 || kevNew > 0 || stale.length + failed.length > 0,
    severity: newCritical > 0 || kevNew > 0 ? 'warning' : 'info',
  };
}
