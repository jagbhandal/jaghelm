/**
 * The Proxmox preset's storage pools (#468): a pool list only from a storage
 * read that answered. The status model ends a pool's episode when a read no
 * longer lists it, so a storage read that failed must give no list at all, not
 * an empty one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import proxmox from './proxmox.js';

const GiB = 1073741824;
const VMS = { data: [{ vmid: 101, name: 'docker', node: 'pve', status: 'running' }] };

test('#468: a storage read that failed gives no pool list, not an empty one', () => {
  // The handler attaches only the extra endpoints that answered (handler.js _extra).
  const out = proxmox.structuredTransform({ ...VMS, _extra: { tasks: { data: [] } } });
  assert.equal(out.storagePools, undefined);
  assert.equal(proxmox.structuredTransform({ ...VMS }).storagePools, undefined);
});

test('#468: a storage read that answered gives its pools, an empty list included', () => {
  const none = proxmox.structuredTransform({ ...VMS, _extra: { storage: { data: [] } } });
  assert.deepEqual(none.storagePools, []);
  const out = proxmox.structuredTransform({
    ...VMS,
    _extra: {
      storage: {
        data: [
          {
            storage: 'local-lvm',
            content: 'images,rootdir',
            plugintype: 'lvmthin',
            disk: 40 * GiB,
            maxdisk: 100 * GiB,
            status: 'available',
          },
          // Storage Proxmox lists but can't read: no size. The dashboard's tile
          // still reads 0; the status model reads no size as no reading.
          { storage: 'nas', content: 'images', plugintype: 'nfs', status: 'unknown' },
        ],
      },
    },
  });
  assert.deepEqual(
    out.storagePools.map((p) => [p.name, p.percent, p.totalGB]),
    [
      ['local-lvm', 40, '100.0'],
      ['nas', 0, '0.0'],
    ]
  );
});

// #483: /cluster/resources?type=storage lists one row per node. Same-named
// pools on different nodes must not share one key in the status model.
const row = (node, storage, disk, extra = {}) => ({
  storage, node, content: 'images', plugintype: 'lvmthin', status: 'available',
  disk: disk * GiB, maxdisk: 100 * GiB, ...extra,
});
const clusterOut = (rows, vms = VMS) =>
  proxmox.structuredTransform({ ...vms, _extra: { storage: { data: rows } } });

test('#483: a two-node cluster with the same pool name reads only the target node', () => {
  const out = clusterOut([row('pve2', 'local-lvm', 95), row('pve', 'local-lvm', 50)]);
  assert.deepEqual(out.storagePools.map((p) => [p.name, p.percent]), [['local-lvm', 50]]);
  const flipped = clusterOut([row('pve', 'local-lvm', 95), row('pve2', 'local-lvm', 50)]);
  assert.deepEqual(flipped.storagePools.map((p) => [p.name, p.percent]), [['local-lvm', 95]]);
});

test('#483: shared storage repeated per node is one pool, not double counted', () => {
  const out = clusterOut([
    row('pve2', 'ceph', 40, { shared: 1 }),
    row('pve', 'ceph', 40, { shared: 1 }),
    row('pve2', 'local-lvm', 95),
  ]);
  assert.deepEqual(out.storagePools.map((p) => p.name), ['ceph']);
});

test('#483: shared storage only listed on another node still shows once', () => {
  const out = clusterOut([
    row('pve2', 'nas', 10, { shared: 1 }),
    row('pve3', 'nas', 10, { shared: 1 }),
  ]);
  assert.deepEqual(out.storagePools.map((p) => p.name), ['nas']);
});

test('#483: rows with no node (single-node shape) are all kept', () => {
  const out = clusterOut([{ ...row('x', 'a', 1), node: undefined }, { ...row('x', 'b', 2), node: undefined }]);
  assert.deepEqual(out.storagePools.map((p) => p.name), ['a', 'b']);
});

// The node that answers the API comes from /cluster/status (local: 1), not
// from whichever VM happens to be listed first.
const TWO_NODE_VMS = (order) => ({
  data: order.map((node, i) => ({ vmid: 100 + i, name: `vm${i}`, node, status: 'running' })),
});
const statusOf = (local) => ({
  data: [
    { type: 'cluster', name: 'lab' },
    { type: 'node', name: 'pve', local: local === 'pve' ? 1 : 0 },
    { type: 'node', name: 'pve2', local: local === 'pve2' ? 1 : 0 },
  ],
});
const poolsFor = (vms, status) =>
  proxmox.structuredTransform({
    ...vms,
    _extra: {
      storage: { data: [row('pve', 'local-lvm', 50), row('pve2', 'local-lvm', 95)] },
      ...(status ? { status } : {}),
    },
  }).storagePools.map((p) => p.percent);

test('#483: the local node from /cluster/status wins over the first VM\'s node', () => {
  assert.deepEqual(poolsFor(TWO_NODE_VMS(['pve', 'pve2']), statusOf('pve2')), [95]);
});

test('#483: the local-node answer does not change with the VM order', () => {
  const a = poolsFor(TWO_NODE_VMS(['pve', 'pve2']), statusOf('pve2'));
  const b = poolsFor(TWO_NODE_VMS(['pve2', 'pve']), statusOf('pve2'));
  assert.deepEqual(a, b);
});

test('#483: without /cluster/status (or a local node) the first VM\'s node is used', () => {
  assert.deepEqual(poolsFor(TWO_NODE_VMS(['pve', 'pve2']), undefined), [50]);
  const noLocal = { data: [{ type: 'node', name: 'pve2', local: 0 }] };
  assert.deepEqual(poolsFor(TWO_NODE_VMS(['pve', 'pve2']), noLocal), [50]);
});

test('#483: the status read is requested as an extra endpoint', () => {
  const eps = proxmox.extraEndpoints(VMS);
  assert.ok(eps.some((e) => e.key === 'status' && e.endpoint === '/api2/json/cluster/status'));
});
