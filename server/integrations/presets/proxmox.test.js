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
