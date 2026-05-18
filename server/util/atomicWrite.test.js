import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { atomicWriteFileSync } from './atomicWrite.js';

test('atomicWriteFileSync writes new file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'hello.txt');
    atomicWriteFileSync(target, 'hello world');
    assert.equal(readFileSync(target, 'utf8'), 'hello world');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicWriteFileSync replaces existing file atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'config.json');
    writeFileSync(target, 'OLD');
    atomicWriteFileSync(target, 'NEW');
    assert.equal(readFileSync(target, 'utf8'), 'NEW');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicWriteFileSync supports Buffer payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'bin');
    atomicWriteFileSync(target, Buffer.from([0x01, 0x02, 0x03]));
    const got = readFileSync(target);
    assert.deepEqual([...got], [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicWriteFileSync cleans up temp file when rename fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    // Use a target inside a non-existent subdirectory to force a rename failure.
    const target = join(dir, 'nonexistent-subdir', 'out.txt');
    assert.throws(() => atomicWriteFileSync(target, 'payload'));
    // The temp file lives in the same parent as the target (which is the
    // non-existent subdir), so openSync itself fails before any temp is
    // created. Verify the parent dir has no leftover tmp files.
    const leftovers = existsSync(join(dir, 'nonexistent-subdir'))
      ? readdirSync(join(dir, 'nonexistent-subdir')).filter((f) => f.includes('.tmp.'))
      : [];
    assert.equal(leftovers.length, 0, 'no temp files should remain');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicWriteFileSync cleans up temp on rename collision with directory', () => {
  // Reproduce a mid-pipeline failure: temp file successfully written, then
  // rename fails because the target path is a directory. Verify the temp is
  // unlinked.
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'iam-a-dir');
    // Make target a directory so renameSync(tmpFile, target) errors with
    // EISDIR (or similar).
    mkdirSync(target);
    assert.throws(() => atomicWriteFileSync(target, 'payload'));
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp.'));
    assert.equal(leftovers.length, 0, `expected no .tmp. leftovers, got ${JSON.stringify(leftovers)}`);
    // Target is still the original directory, untouched.
    assert.ok(statSync(target).isDirectory());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
