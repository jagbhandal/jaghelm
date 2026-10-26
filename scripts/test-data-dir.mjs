// Preloaded by `npm test` (`node --import`) into the test runner and into every
// test file's process: points JAGHELM_DATA_DIR at a fresh temp dir, so no test
// reads or writes the checkout's data/ (#261). It has to come first: a test
// file's static imports run before its first line, so a server module they load
// (any store, via server/util/dataDir.js) fixes its path before a file that sets
// JAGHELM_DATA_DIR itself gets to. A file that sets its own dir still may; this
// is only the floor. The dir is removed when the process exits.
// Guarded by scripts/test-data-dir.test.mjs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'jaghelm-test-data-'));
process.env.JAGHELM_DATA_DIR = dir;
// A configured install (#704): PROMETHEUS_URL has no default, so a test that
// is not about it being unset runs with one. Nothing listens on port 1, and no
// test reaches a real Prometheus. A test of the unset state passes its own env
// or deletes it.
process.env.PROMETHEUS_URL ||= 'http://127.0.0.1:1';
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
