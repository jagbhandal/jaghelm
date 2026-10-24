import { describe, it, expect } from 'vitest';
import { backupRows, jobKey, withBackup } from './backupJobs.js';

const STATUSES = [
  { node: 'pve', jobs: [{ job: 'proxmox-backup' }, { job: 'trim' }] },
  { node: 'nas', jobs: [{ job: 'b2-sync' }] },
];

describe('backupRows', () => {
  it('lists every reporting job, sorted, marked when the config names it', () => {
    expect(backupRows(STATUSES, ['pve:proxmox-backup'])).toEqual([
      { key: 'nas:b2-sync', node: 'nas', job: 'b2-sync', backup: false, reporting: true },
      { key: 'pve:proxmox-backup', node: 'pve', job: 'proxmox-backup', backup: true, reporting: true },
      { key: 'pve:trim', node: 'pve', job: 'trim', backup: false, reporting: true },
    ]);
  });

  it('keeps a marked job nothing reports any more, so it can be unmarked', () => {
    const rows = backupRows(STATUSES, ['old:gone']);
    expect(rows.find((r) => r.key === 'old:gone')).toEqual({
      key: 'old:gone',
      node: 'old',
      job: 'gone',
      backup: true,
      reporting: false,
    });
  });

  it('a job is never a backup by its name', () => {
    expect(backupRows([{ node: 'x', jobs: [{ job: 'nightly-backup' }] }], []).every((r) => !r.backup)).toBe(true);
  });

  it('reads no config, no statuses and junk entries as empty', () => {
    expect(backupRows(null, undefined)).toEqual([]);
    expect(backupRows(null, [1, null, 'nocolon', ':x', 'x:'])).toEqual([]);
  });

  it('job names with colons keep everything after the first colon', () => {
    expect(jobKey('pve', 'a:b')).toBe('pve:a:b');
    expect(backupRows(null, ['pve:a:b'])[0]).toMatchObject({ node: 'pve', job: 'a:b' });
  });
});

describe('withBackup', () => {
  it('marks a job once, keeping the others in order', () => {
    expect(withBackup(['a:x'], 'b:y', true)).toEqual(['a:x', 'b:y']);
    expect(withBackup(['a:x', 'b:y'], 'b:y', true)).toEqual(['a:x', 'b:y']);
  });
  it('unmarks a job', () => {
    expect(withBackup(['a:x', 'b:y'], 'a:x', false)).toEqual(['b:y']);
    expect(withBackup(undefined, 'a:x', false)).toEqual([]);
  });
  it('drops entries the server would drop', () => {
    expect(withBackup(['a:x', 3, 'bad'], 'b:y', true)).toEqual(['a:x', 'b:y']);
  });
});
