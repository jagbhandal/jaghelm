/**
 * Atomic file writes — write to a temp sibling, fsync, then rename over the
 * target. The rename(2) is atomic on POSIX filesystems, so a reader will only
 * ever see the old or new file, never a half-written one. fsync before rename
 * guarantees the new bytes are on disk before the directory entry flips, so a
 * crash mid-write can't leave a zero-byte or truncated config.
 *
 * Used everywhere we persist user-editable JSON/YAML state.
 */

import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync, linkSync } from 'fs';

/**
 * Synchronously write `data` to `targetPath` atomically.
 *
 * @param {string} targetPath  Final destination path
 * @param {string|Buffer|Uint8Array[]} data Contents to write; an array is
 *   written chunk by chunk, in order, without joining it into one buffer first
 * @param {object} [options]
 * @param {number} [options.mode=0o644] File mode for the temp file
 */
export function atomicWriteFileSync(targetPath, data, options = {}) {
  const mode = options.mode ?? 0o644;
  // Temp name includes pid + timestamp so concurrent writers in the same
  // process (or across processes) don't collide on the temp file itself.
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  let fd;
  try {
    fd = openSync(tmpPath, 'w', mode);
    const chunks = Array.isArray(data) ? data : [Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8')];
    let position = 0;
    for (const chunk of chunks) {
      writeSync(fd, chunk, 0, chunk.length, position);
      position += chunk.length;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup — if close already happened or never happened, this
    // can still leave a stale temp on truly weird FS errors, but we shouldn't
    // mask the real error with a cleanup failure.
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmpPath); } catch { /* tmp may not exist; ignore */ }
    throw err;
  }
}

/**
 * Create `targetPath` with `data`, only if it doesn't exist, atomically: the
 * bytes go to a temp sibling (fsynced), which is then hard-linked into place.
 * link(2) fails when the target exists, so two processes racing to create it
 * can't both succeed or overwrite each other, and a reader sees the whole
 * file or none. The temp file is always removed.
 *
 * @param {string} targetPath
 * @param {Buffer} data
 * @param {object} [options]
 * @param {number} [options.mode=0o644] File mode
 * @returns {boolean} true when this call created it, false when it was there
 */
export function createExclusiveFileSync(targetPath, data, options = {}) {
  const mode = options.mode ?? 0o644;
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  let fd;
  try {
    fd = openSync(tmpPath, 'wx', mode);
    writeSync(fd, data, 0, data.length, 0);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try {
      linkSync(tmpPath, targetPath);
      return true;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') return false;
      throw err;
    }
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
    try { unlinkSync(tmpPath); } catch { /* never created; ignore */ }
  }
}
