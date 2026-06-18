import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAllowedMime, extForMime, uploadFilename, createUploadMiddleware } from './upload.js';

test('allowlist accepts only raster image types', () => {
  for (const m of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    assert.ok(isAllowedMime(m), m);
  }
});

test('allowlist rejects SVG and executables (stored-XSS / arbitrary upload)', () => {
  for (const m of ['image/svg+xml', 'text/html', 'application/x-msdownload', 'application/octet-stream', '']) {
    assert.equal(isAllowedMime(m), false, m);
  }
});

test('extension is server-derived from MIME, not the client filename', () => {
  assert.equal(extForMime('image/jpeg'), '.jpg');
  assert.equal(extForMime('image/svg+xml'), null);
});

test('filename uses a fixed prefix + derived ext (logo vs bg), never client input', () => {
  assert.equal(uploadFilename('logo', 'image/png'), 'logo.png');
  assert.equal(uploadFilename('background', 'image/webp'), 'bg.webp');
  assert.equal(uploadFilename('logo', 'image/svg+xml'), null);
});

test('createUploadMiddleware builds a multer instance (multer 2.x API)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jh-upload-'));
  try {
    const mw = createUploadMiddleware(dir);
    assert.equal(typeof mw.single, 'function');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
