/**
 * The refresh loop writes a running container's refreshed lastSeenAt only every
 * PRESENCE_FLUSH_MS, and the push snapshot only when its alert state changes,
 * so the shutdown path (stopBackgroundRefresh) writes both, and the next start
 * doesn't read older ones (#241).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'jh-shutdown-'));
process.env.JAGHELM_DATA_DIR = dataDir;
const registryPath = join(dataDir, 'container-registry.json');
const seenAt = Date.now() - 60_000;
writeFileSync(
  registryPath,
  JSON.stringify({ redis: { lastSeenNode: 'vm103', firstSeenAt: seenAt - 600_000, lastSeenAt: seenAt } })
);

const snapshotPath = join(dataDir, 'push-snapshot.json');
const host = (cpu) => ({ services: {}, hosts: { n1: { reachable: true, cpu, mem: 0.1, disk: 0.1 } }, ups: { state: 'online' }, cron: {} });
writeFileSync(snapshotPath, JSON.stringify(host(0.85)));

const { containerRegistry } = await import('./containerRegistry.js');
const { pushSnapshot, stopBackgroundRefresh } = await import('./refresh.js');

after(() => rmSync(dataDir, { recursive: true, force: true }));

const lastSeenOnDisk = () => JSON.parse(readFileSync(registryPath, 'utf8')).redis.lastSeenAt;

test('stopBackgroundRefresh writes the container registry\'s refreshed lastSeenAt and the push snapshot', () => {
  const now = Date.now();
  containerRegistry.recordSeen('redis', 'vm103', now);
  containerRegistry.save();
  assert.equal(lastSeenOnDisk(), seenAt, 'inside the flush interval: not written by the cycle');
  pushSnapshot.prev();
  pushSnapshot.advance(host(0.6), { cpu: 0.9, mem: 0.9, disk: 0.9, hysteresis: 0.05 });
  assert.equal(JSON.parse(readFileSync(snapshotPath, 'utf8')).hosts.n1.cpu, 0.85, 'same alert state: not written');

  stopBackgroundRefresh();
  assert.equal(lastSeenOnDisk(), now);
  assert.equal(JSON.parse(readFileSync(snapshotPath, 'utf8')).hosts.n1.cpu, 0.6);
});
