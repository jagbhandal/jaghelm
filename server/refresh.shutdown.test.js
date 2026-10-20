/**
 * The refresh loop writes a running container's refreshed lastSeenAt only every
 * PRESENCE_FLUSH_MS, so the shutdown path (stopBackgroundRefresh) writes it,
 * and the next start doesn't read an older one (#241). The push snapshot holds
 * only alert state since #292 (levels, not readings), so it is written as it
 * changes; shutdown flushes it too, which matters only after a failed write.
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
const host = (cpu) => ({ services: {}, hosts: { n1: { reachable: true, levels: { cpu } } }, ups: { state: 'online' }, cron: {} });
writeFileSync(snapshotPath, JSON.stringify(host('ok')));

const { containerRegistry } = await import('./containerRegistry.js');
const { pushSnapshot, stopBackgroundRefresh } = await import('./refresh.js');

after(() => rmSync(dataDir, { recursive: true, force: true }));

const lastSeenOnDisk = () => JSON.parse(readFileSync(registryPath, 'utf8')).redis.lastSeenAt;

test('stopBackgroundRefresh writes the container registry\'s refreshed lastSeenAt and the push snapshot', () => {
  const now = Date.now();
  containerRegistry.recordSeen('redis', 'vm103', now);
  containerRegistry.save();
  assert.equal(lastSeenOnDisk(), seenAt, 'inside the flush interval: not written by the cycle');
  const cpuOnDisk = () => JSON.parse(readFileSync(snapshotPath, 'utf8')).hosts.n1.levels.cpu;
  pushSnapshot.prev();
  pushSnapshot.advance(host('warn'));
  assert.equal(cpuOnDisk(), 'warn', 'a new level is written at once');

  stopBackgroundRefresh();
  assert.equal(lastSeenOnDisk(), now);
  assert.equal(cpuOnDisk(), 'warn');
});
