/**
 * Atomic file writes — write to a temp sibling, fsync, then rename over the
 * target. The rename(2) is atomic on POSIX filesystems, so a reader will only
 * ever see the old or new file, never a half-written one. fsync before rename
 * guarantees the new bytes are on disk before the directory entry flips, so a
 * crash mid-write can't leave a zero-byte or truncated config.
 *
 * Used everywhere we persist user-editable JSON/YAML state.
 */

import { openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'fs';

/**
 * Synchronously write `data` to `targetPath` atomically.
 *
 * @param {string} targetPath  Final destination path
 * @param {string|Buffer} data Contents to write
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
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    writeSync(fd, buf, 0, buf.length, 0);
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
