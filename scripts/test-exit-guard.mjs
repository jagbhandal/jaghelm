// Preloaded by `npm test` (`node --import`) into the test runner and into every
// test file's process: fails a test file whose process is still running
// --test-timeout ms after its tests finished, instead of letting it run forever.
//
// Why (#375): up to Node 24, --test-timeout also bounded each test file's process,
// so a file that left a server, interval or socket open was cancelled and failed
// the run (#196, #203). From Node 26 it bounds only each test, and such a file
// keeps its process, and with it `npm test` and CI, running until killed. This
// puts the bound back: after the file's last test, a timer of the same length
// that cannot itself keep the process alive. A file that closes everything exits
// before it fires. Without --test-timeout (or with 0) it does nothing, like Node.
//
// The timer starts in a root after hook registered here, at preload, so it runs
// before the file's own root after hooks: their cleanup counts against the same
// budget, and an after hook that slow fails the file too.
//
// It only bounds files that register a test. Root after hooks run once the
// file's tests are done, or at beforeExit if it has none, so a file that hangs
// with a handle open before registering a test (a top-level await that never
// settles) never arms it and still hangs.
// Guarded by scripts/test-exit-guard.test.mjs.
import { after } from 'node:test';

// The runner starts each test file's process with NODE_TEST_CONTEXT set; the
// runner process itself has none, and must not register a test hook.
const arg = process.execArgv.findLast((a) => a.startsWith('--test-timeout='));
const timeoutMs = Number(arg?.slice('--test-timeout='.length));

if (process.env.NODE_TEST_CONTEXT && timeoutMs > 0 && Number.isFinite(timeoutMs)) {
  after(() => {
    setTimeout(() => {
      process.stderr.write(
        `test-exit-guard: ${process.argv[1]} still running ${timeoutMs} ms after its tests finished ` +
          '(its after hooks included): a server, interval or socket was left open (close it in an ' +
          'after hook), or an after hook took that long\n'
      );
      process.exit(1);
    }, timeoutMs).unref();
  });
}
