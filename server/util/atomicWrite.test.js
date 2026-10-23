import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { atomicWriteFileSync, createExclusiveFileSync } from './atomicWrite.js';

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

test('atomicWriteFileSync writes an array of chunks in order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'chunks');
    atomicWriteFileSync(target, [Buffer.from('ab'), new Uint8Array([0x63]), Buffer.alloc(0), Buffer.from('de')]);
    assert.equal(readFileSync(target, 'utf8'), 'abcde');
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

test('createExclusiveFileSync creates a missing file with its mode, and leaves no temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'key');
    assert.equal(createExclusiveFileSync(target, Buffer.from('first'), { mode: 0o600 }), true);
    assert.equal(readFileSync(target, 'utf8'), 'first');
    assert.equal(statSync(target).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(dir), ['key']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createExclusiveFileSync leaves a file that is already there as it is (another process made it)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'key');
    writeFileSync(target, 'theirs');
    assert.equal(createExclusiveFileSync(target, Buffer.from('mine'), { mode: 0o600 }), false);
    assert.equal(readFileSync(target, 'utf8'), 'theirs');
    assert.deepEqual(readdirSync(dir), ['key']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The directory is fsynced too (ADR 0001) ─────────────────────────────
// The rename (or link) is a change to the directory. Until the directory is
// fsynced, a power cut can bring back the old name: the old file, or none.

/**
 * Run `fn` with fs functions wrapped: `wraps` maps a name to (orig) => fn.
 * The module's named imports see the wrappers (syncBuiltinESMExports).
 */
function withFs(wraps, fn) {
  const orig = {};
  for (const [name, wrap] of Object.entries(wraps)) {
    orig[name] = fs[name];
    fs[name] = wrap(orig[name]);
  }
  syncBuiltinESMExports();
  try {
    return fn();
  } finally {
    Object.assign(fs, orig);
    syncBuiltinESMExports();
  }
}

/** The fsyncs and renames/links a write makes, in order; `dirFsync` replaces the directory's fsync. */
function traceWrite(dir, write, dirFsync = null) {
  const events = [];
  const dirFds = new Set();
  withFs(
    {
      openSync: (o) => (path, ...rest) => {
        const fd = o(path, ...rest);
        if (path === dir) dirFds.add(fd);
        return fd;
      },
      fsyncSync: (o) => (fd) => {
        if (!dirFds.has(fd)) return events.push('fsync file'), o(fd);
        events.push('fsync dir');
        return dirFsync ? dirFsync() : o(fd);
      },
      renameSync: (o) => (from, to) => (o(from, to), events.push('rename')),
      linkSync: (o) => (from, to) => (o(from, to), events.push('link')),
    },
    write
  );
  return events;
}

const errno = (code) => Object.assign(new Error(`${code}: test`), { code });

test('atomicWriteFileSync fsyncs the directory after the rename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'state.json');
    const events = traceWrite(dir, () => atomicWriteFileSync(target, 'new'));
    assert.deepEqual(events, ['fsync file', 'rename', 'fsync dir']);
    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createExclusiveFileSync fsyncs the directory after the link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'key');
    const events = traceWrite(dir, () => createExclusiveFileSync(target, Buffer.from('k'), { mode: 0o600 }));
    assert.deepEqual(events, ['fsync file', 'link', 'fsync dir']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a platform that can't fsync a directory (EINVAL, EISDIR) still writes; another error throws", () => {
  const dir = mkdtempSync(join(tmpdir(), 'aw-'));
  try {
    const target = join(dir, 'state.json');
    for (const code of ['EINVAL', 'EISDIR']) {
      traceWrite(dir, () => atomicWriteFileSync(target, code), () => {
        throw errno(code);
      });
      assert.equal(readFileSync(target, 'utf8'), code, `${code} from the directory's fsync`);
    }
    // Windows can't open a directory at all.
    withFs({ openSync: (o) => (path, ...rest) => (path === dir ? (() => { throw errno('EISDIR'); })() : o(path, ...rest)) }, () =>
      atomicWriteFileSync(target, 'no open')
    );
    assert.equal(readFileSync(target, 'utf8'), 'no open');

    assert.throws(
      () => traceWrite(dir, () => atomicWriteFileSync(target, 'EIO'), () => { throw errno('EIO'); }),
      { code: 'EIO' },
      'a real I/O error is not swallowed'
    );
    assert.deepEqual(readdirSync(dir), ['state.json'], 'and leaves no temp file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
