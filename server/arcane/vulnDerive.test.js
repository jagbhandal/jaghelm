import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  imageRepo,
  displayName,
  findingKey,
  currentFindings,
  scanHealth,
  diffFindings,
  kevCount,
  buildDigest,
  STALE_SCAN_MS,
} from './vulnDerive.js';

const fx = (n) => {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
  return 'success' in body ? body.data : body;
};
const NOW = Date.parse('2026-10-18T14:00:00Z');
const DAY = 86_400_000;

test('imageRepo drops tag and digest and normalises Docker Hub names', () => {
  const cases = [
    ['nextcloud:latest', 'nextcloud'],
    ['nextcloud', 'nextcloud'],
    ['docker.io/library/nextcloud:30', 'nextcloud'],
    ['index.docker.io/library/redis:7', 'redis'],
    ['docker.io/gitea/gitea:1.22', 'gitea/gitea'],
    ['ghcr.io/immich-app/immich-server:release', 'ghcr.io/immich-app/immich-server'],
    ['ghcr.io/immich-app/immich-server@sha256:abc', 'ghcr.io/immich-app/immich-server'],
    ['repo/img:1.0@sha256:abc', 'repo/img'],
    ['registry.local:5000/team/app:2', 'registry.local:5000/team/app'],
    ['registry.local:5000/app', 'registry.local:5000/app'],
    ['GHCR.io/Org/App:1', 'ghcr.io/org/app'],
    // An image id (an untagged image) stays as it is: stable for as long as the image exists.
    ['sha256:0123456789abcdef', 'sha256:0123456789abcdef'],
    ['', ''],
    [null, ''],
    [42, ''],
  ];
  for (const [ref, want] of cases) assert.equal(imageRepo(ref), want, String(ref));
});

test('displayName is the last path segment; an image id shows its first 12 hex digits', () => {
  assert.equal(displayName('ghcr.io/immich-app/immich-server'), 'immich-server');
  assert.equal(displayName('nextcloud'), 'nextcloud');
  assert.equal(displayName('sha256:0123456789abcdef0123'), '0123456789ab');
});

test('currentFindings keys by image repository, CVE and package, critical and high fixable only', () => {
  const rows = fx('vulnerabilities-all');
  const cur = currentFindings([
    ...rows,
    // Ignored defensively: medium, unfixed, missing fields, not an object.
    { ...rows[0], severity: 'MEDIUM', vulnerabilityId: 'CVE-2099-0100' },
    { ...rows[0], fixedVersion: '', vulnerabilityId: 'CVE-2099-0101' },
    { ...rows[0], pkgName: '' },
    { ...rows[0], imageName: undefined },
    null,
    'x',
  ]);
  assert.deepEqual(
    [...cur.values()].map((e) => [e.repo, e.id, e.pkg, e.sev]),
    [
      ['ghcr.io/immich-app/immich-server', 'CVE-2099-0001', 'openssl', 'C'],
      ['ghcr.io/immich-app/immich-server', 'CVE-2099-0002', 'libcurl', 'H'],
      ['gitea/gitea', 'CVE-2099-0002', 'libcurl', 'H'],
      ['gitea/gitea', 'GHSA-0000-0000-0001', 'golang.org/x/net', 'H'],
      ['redis', 'CVE-2099-0003', 'zlib', 'H'],
    ]
  );
  assert.ok(cur.has(findingKey('redis', 'CVE-2099-0003', 'zlib')));
});

test('currentFindings: one key per repository across tags, the worse severity wins', () => {
  const row = (imageName, severity, imageId) => ({
    vulnerabilityId: 'CVE-2099-0009',
    pkgName: 'busybox',
    fixedVersion: '1.2',
    severity,
    imageId,
    imageName,
  });
  const cur = currentFindings([
    row('app:1', 'HIGH', 'sha256:1'),
    row('app:2', 'CRITICAL', 'sha256:2'),
    row('docker.io/library/app:3', 'HIGH', 'sha256:3'),
  ]);
  assert.equal(cur.size, 1);
  assert.equal(cur.get(findingKey('app', 'CVE-2099-0009', 'busybox')).sev, 'C');
});

test('currentFindings caps each key field at 256 characters', () => {
  const long = 'p'.repeat(400);
  const cur = currentFindings([
    {
      vulnerabilityId: 'CVE-1',
      pkgName: long,
      fixedVersion: '1',
      severity: 'HIGH',
      imageName: 'a:1',
    },
  ]);
  assert.equal([...cur.values()][0].pkg.length, 256);
});

test('scanHealth: stale (over 9 days or never scanned) and failed scans of running images', () => {
  const containers = fx('containers');
  const h = scanHealth({
    containers,
    summaries: fx('vulnerabilities-summaries').summaries,
    nowMs: NOW,
  });
  // redis: completed 13 days ago. nextcloud: failed. whoami: exited, never scanned (ignored).
  assert.deepEqual(h.stale, ['redis']);
  assert.deepEqual(h.failed, ['nextcloud']);
  assert.equal(h.scannedAny, true);
});

test('scanHealth: a running image without any scan is stale; a scan in progress is not', () => {
  const containers = [
    { names: ['/a'], image: 'a:1', imageId: 'sha256:a', state: 'running' },
    { names: ['/b'], image: 'b:1', imageId: 'sha256:b', state: 'running' },
    { names: ['/c'], image: 'org/c:1', imageId: 'sha256:c', state: 'running' },
    { names: ['/c2'], image: 'org/c:1', imageId: 'sha256:c', state: 'running' }, // same image once
  ];
  const summaries = {
    'sha256:b': {
      imageId: 'sha256:b',
      status: 'scanning',
      scanTime: new Date(NOW - 60_000).toISOString(),
    },
    'sha256:c': {
      imageId: 'sha256:c',
      status: 'completed',
      scanTime: new Date(NOW - STALE_SCAN_MS - 1).toISOString(),
    },
  };
  const h = scanHealth({ containers, summaries, nowMs: NOW });
  assert.deepEqual(h.stale, ['a', 'c']);
  assert.deepEqual(h.failed, []);
  // Exactly 9 days is not yet stale.
  summaries['sha256:c'].scanTime = new Date(NOW - STALE_SCAN_MS).toISOString();
  assert.deepEqual(scanHealth({ containers, summaries, nowMs: NOW }).stale, ['a']);
  // An unparseable scan time is treated as no scan.
  summaries['sha256:c'].scanTime = 'not a date';
  assert.deepEqual(scanHealth({ containers, summaries, nowMs: NOW }).stale, ['a', 'c']);
});

test('scanHealth: repositories whose latest scan is not a completed one are uncertain', () => {
  const containers = [
    { image: 'ok:1', imageId: 'sha256:ok', state: 'running' },
    { image: 'failed:1', imageId: 'sha256:f', state: 'running' },
    { image: 'never:1', imageId: 'sha256:n', state: 'exited' },
    { image: 'busy:1', imageId: 'sha256:p', state: 'running' },
    { image: 'sha256:deadbeef', imageId: 'sha256:deadbeef', state: 'running' },
  ];
  const summaries = {
    'sha256:ok': { status: 'completed', scanTime: new Date(NOW).toISOString() },
    'sha256:f': { status: 'failed', scanTime: new Date(NOW).toISOString() },
    'sha256:p': { status: 'pending', scanTime: new Date(NOW).toISOString() },
  };
  const h = scanHealth({ containers, summaries, nowMs: NOW });
  assert.deepEqual([...h.uncertain].sort(), ['busy', 'failed', 'never', 'sha256:deadbeef']);
});

test('scanHealth: no summaries for any image means no scan results', () => {
  const h = scanHealth({ containers: fx('containers'), summaries: {}, nowMs: NOW });
  assert.equal(h.scannedAny, false);
  // Malformed input never throws.
  const bad = scanHealth({ containers: 'x', summaries: null, nowMs: NOW });
  assert.deepEqual([bad.stale, bad.failed, bad.scannedAny], [[], [], false]);
  // A prototype-named image id is not read from the prototype.
  const proto = scanHealth({
    containers: [{ image: 'a:1', imageId: '__proto__', state: 'running' }],
    summaries: {},
    nowMs: NOW,
  });
  assert.deepEqual(proto.stale, ['a']);
});

const entry = (repo, id, pkg, sev) => ({ repo, id, pkg, sev });
const mapOf = (...entries) => new Map(entries.map((e) => [findingKey(e.repo, e.id, e.pkg), e]));

test('diffFindings: new, unchanged and fixed keys', () => {
  const a = entry('app', 'CVE-1', 'p', 'C');
  const b = entry('app', 'CVE-2', 'p', 'H');
  const c = entry('db', 'CVE-3', 'q', 'H');
  const { added, fixed, next } = diffFindings({
    prev: mapOf(a, b),
    current: mapOf(b, c),
    uncertain: new Set(),
  });
  assert.deepEqual(added, [c]);
  assert.deepEqual(fixed, [a]);
  assert.deepEqual([...next.values()], [b, c]);
});

test('diffFindings: an uncertain repository keeps its previous keys and reports nothing fixed', () => {
  const a = entry('app', 'CVE-1', 'p', 'C');
  const b = entry('db', 'CVE-2', 'q', 'H');
  const { added, fixed, next } = diffFindings({
    prev: mapOf(a, b),
    current: new Map(),
    uncertain: new Set(['app']),
  });
  assert.deepEqual(added, []);
  assert.deepEqual(fixed, [b]);
  assert.deepEqual([...next.values()], [a]);
});

test('kevCount reads the known-exploited driver, null when threat intel is off or malformed', () => {
  assert.equal(kevCount(fx('vulnerabilities-overview')), 1);
  assert.equal(kevCount({ drivers: { knownExploited: 3 }, threatIntel: { enabled: false } }), null);
  assert.equal(kevCount({ drivers: { knownExploited: -1 }, threatIntel: { enabled: true } }), null);
  assert.equal(kevCount({ threatIntel: { enabled: true } }), null);
  assert.equal(kevCount(null), null);
});

const noHealth = { stale: [], failed: [] };

test('buildDigest counts new findings, ranks images and picks warning for a new critical', () => {
  const added = [
    entry('nextcloud', 'CVE-1', 'a', 'C'),
    entry('nextcloud', 'CVE-2', 'b', 'C'),
    entry('nextcloud', 'CVE-3', 'c', 'H'),
    entry('ghcr.io/immich-app/immich-server', 'CVE-4', 'd', 'C'),
    entry('redis', 'CVE-5', 'e', 'H'),
    entry('redis', 'CVE-6', 'f', 'H'),
    entry('alpha', 'CVE-7', 'g', 'H'),
  ];
  const d = buildDigest({
    added,
    fixed: [entry('x', 'CVE-9', 'z', 'H')],
    kev: 1,
    prevKev: 1,
    health: noHealth,
  });
  assert.equal(d.newCritical, 3);
  assert.equal(d.newHigh, 4);
  assert.equal(d.images, 4);
  assert.deepEqual(d.top, [
    { name: 'nextcloud', critical: 2, high: 1 },
    { name: 'immich-server', critical: 1, high: 0 },
    { name: 'redis', critical: 0, high: 2 },
  ]);
  assert.equal(d.fixed, 1);
  assert.equal(d.kev, 1);
  assert.equal(d.kevNew, 0);
  assert.equal(d.push, true);
  assert.equal(d.severity, 'warning');
});

test('buildDigest: new highs only is info; nothing new and healthy does not push', () => {
  const highs = buildDigest({
    added: [entry('a', 'CVE-1', 'p', 'H')],
    fixed: [],
    kev: 0,
    prevKev: 0,
    health: noHealth,
  });
  assert.equal(highs.push, true);
  assert.equal(highs.severity, 'info');
  // Fixed findings alone are never a reason to push.
  const quiet = buildDigest({
    added: [],
    fixed: [entry('a', 'CVE-1', 'p', 'C')],
    kev: 2,
    prevKev: 2,
    health: noHealth,
  });
  assert.equal(quiet.push, false);
  assert.equal(quiet.fixed, 1);
});

test('buildDigest: a new KEV entry pushes as a warning; fewer or unknown does not', () => {
  const up = buildDigest({ added: [], fixed: [], kev: 3, prevKev: 1, health: noHealth });
  assert.deepEqual([up.push, up.kevNew, up.severity], [true, 2, 'warning']);
  for (const [kev, prevKev] of [
    [1, 3],
    [2, null],
    [null, 1],
    [null, null],
  ]) {
    const d = buildDigest({ added: [], fixed: [], kev, prevKev, health: noHealth });
    assert.deepEqual([d.push, d.kevNew], [false, 0], `${kev} ${prevKev}`);
  }
});

test('buildDigest: scan health problems push as info', () => {
  const d = buildDigest({
    added: [],
    fixed: [],
    kev: 0,
    prevKev: 0,
    health: { stale: ['redis'], failed: ['nextcloud'] },
  });
  assert.deepEqual([d.push, d.severity], [true, 'info']);
  assert.deepEqual([d.stale, d.failed], [['redis'], ['nextcloud']]);
});

test('STALE_SCAN_MS is nine days', () => {
  assert.equal(STALE_SCAN_MS, 9 * DAY);
});
