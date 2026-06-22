import { describe, it, expect } from 'vitest';
import { proxmoxChildrenForNode } from './NodePanel';

const PROXMOX = {
  _preset: 'proxmox',
  _vms: [{ name: 'vm1', vmid: 100 }],
  _storagePools: [{ name: 'local-lvm' }],
  _lastBackup: { ok: true },
  Running: '1/1',
};

describe('proxmoxChildrenForNode', () => {
  it('renders proxmox children on a node literally named "pve" (no _target) — legacy behavior', () => {
    const out = proxmoxChildrenForNode({ proxmox: PROXMOX }, 'pve');
    expect(out).toEqual({
      vms: PROXMOX._vms,
      storage: PROXMOX._storagePools,
      backup: PROXMOX._lastBackup,
    });
  });

  it('does NOT render on a non-pve node when the integration has no _target', () => {
    expect(proxmoxChildrenForNode({ proxmox: PROXMOX }, 'proxmox')).toBeNull();
  });

  it('renders on the node named in _target even when it is not "pve"', () => {
    // Bug fix: previously gated on nodeKey === "pve", so a node named "proxmox"
    // silently lost its VM/storage/backup panels.
    const data = { proxmox: { ...PROXMOX, _target: 'proxmox:proxmox-ve' } };
    expect(proxmoxChildrenForNode(data, 'proxmox')).toEqual({
      vms: PROXMOX._vms,
      storage: PROXMOX._storagePools,
      backup: PROXMOX._lastBackup,
    });
    // And NOT on a different node.
    expect(proxmoxChildrenForNode(data, 'pve')).toBeNull();
  });

  it('finds an instance-keyed proxmox integration (key "proxmox_pve1", not "proxmox")', () => {
    // An integration created with an instance name is stored as "proxmox_<instance>",
    // so keying off integrationData.proxmox alone missed it entirely.
    const data = { proxmox_pve1: { ...PROXMOX, _target: 'pve1:proxmox-ve' } };
    expect(proxmoxChildrenForNode(data, 'pve1')).toMatchObject({ vms: PROXMOX._vms });
  });

  it('returns null when no proxmox integration is present', () => {
    expect(proxmoxChildrenForNode({ adguard: { Blocked: 5 } }, 'pve')).toBeNull();
    expect(proxmoxChildrenForNode({}, 'pve')).toBeNull();
    expect(proxmoxChildrenForNode(undefined, 'pve')).toBeNull();
  });

  it('tolerates a partial proxmox entry (only some structured fields present)', () => {
    const data = { proxmox: { _preset: 'proxmox', _vms: [{ vmid: 1 }] } };
    expect(proxmoxChildrenForNode(data, 'pve')).toEqual({
      vms: [{ vmid: 1 }],
      storage: null,
      backup: null,
    });
  });

  it('identifies proxmox by _preset, not by output-field shape (no false positive)', () => {
    // A non-proxmox preset that happens to emit a _vms-shaped field must NOT be
    // treated as proxmox — detection is identity-based, not shape-based.
    const data = { mystery: { _preset: 'adguard', _vms: [{ vmid: 1 }], _target: 'pve:x' } };
    expect(proxmoxChildrenForNode(data, 'pve')).toBeNull();
  });
});
