// Runs the node:test suite and fails unless every expected test ran. Node built-ins only.
// Usage:
//   node scripts/test-floor.mjs [--min=N] <command> [args...]
//   npm run test:ci   (= node scripts/test-floor.mjs npm test; what CI runs)
//
// The command's stdout passes through unchanged. When it exits, the summary it printed
// (TAP `# pass N` or spec `ℹ pass N`; the last one wins) is checked. The run fails if the
// command failed, if there is no summary, if any test was cancelled (a file that hit
// --test-timeout, usually because it left a server, interval or socket open), or if
// fewer than MIN_PASSING tests passed. Skipped and todo tests do not count.
//
// Why (#196, #203): `node --test --test-force-exit` dropped 4-8% of the tests in every
// run and still exited 0, so nothing noticed. A floor turns a silent drop into a failure.
//
// Bumping the floor: MIN_PASSING is a floor, not an exact count, so adding tests never
// breaks CI. When the count is more than 2% above it, each run prints a notice to raise
// it, and the release PR raises it to the current `# pass` (docs/RELEASING.md). When a
// change removes tests on purpose, lower it in the same commit and say why.
//
// A run reports 785 today, 9 of them duplicates: registry.js loads every .js file in
// presets/, test files included, so the gitlab and nextcloud preset tests run twice
// (#223). Merged with the fix for #223, the suite passes 778. The floor (773) is below
// both, so either can merge first; raise it as tests land.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MIN_PASSING = 782;
const STALE_MARGIN = 0.02;

const KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
const SUMMARY_LINE = new RegExp(`^(?:#|ℹ) (${KEYS.join('|')}) (\\d+)\\s*$`, 'gm');
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

// Counts from the runner's closing summary, or null when there is none.
export function parseSummary(output) {
  const counts = {};
  for (const [, key, n] of output.replace(ANSI, '').matchAll(SUMMARY_LINE)) counts[key] = Number(n);
  if (counts.tests === undefined || counts.pass === undefined) return null;
  return Object.fromEntries(KEYS.map((k) => [k, counts[k] ?? 0]));
}

// Problems with a parsed summary; empty when the run is complete and green.
export function checkSummary(summary, minPassing) {
  if (!summary) return ['no test summary found in the output (did the runner crash or change reporter?)'];
  const problems = [];
  if (summary.fail > 0) problems.push(`${summary.fail} test(s) failed`);
  if (summary.cancelled > 0) {
    problems.push(
      `${summary.cancelled} test(s) cancelled: a test file timed out or was cut short ` +
        '(look for a server, interval or socket left open after its tests)',
    );
  }
  if (summary.pass < minPassing) {
    problems.push(
      `only ${summary.pass} tests passed but the floor is ${minPassing}: tests were dropped or removed ` +
        '(if removed on purpose, lower MIN_PASSING in scripts/test-floor.mjs)',
    );
  }
  return problems;
}

// A nudge to raise the floor once the suite has grown well past it; null otherwise.
export function staleFloorNotice(summary, minPassing) {
  if (summary.pass <= minPassing * (1 + STALE_MARGIN)) return null;
  return `${summary.pass} passed; consider raising MIN_PASSING to ${summary.pass}`;
}

async function main(argv) {
  const args = [...argv];
  let minPassing = MIN_PASSING;
  const min = /^--min=(\d+)$/.exec(args[0] ?? '');
  if (min) {
    minPassing = Number(min[1]);
    args.shift();
  }
  if (args.length === 0) {
    console.error('usage: node scripts/test-floor.mjs [--min=N] <command> [args...]');
    return 2;
  }

  const child = spawn(args[0], args.slice(1), { stdio: ['inherit', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  // Pass a CI cancel or Ctrl-C on, so the command is not left running on its own.
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  const { status, signal } = await new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(`test-floor: could not run ${args[0]}: ${err.message}`);
      resolve({ status: 1, signal: null });
    });
    child.on('close', (code, sig) => resolve({ status: code, signal: sig }));
  });
  if (signal) {
    console.error(`test-floor: child killed by ${signal}`);
    return 1;
  }

  const summary = parseSummary(output);
  const problems = checkSummary(summary, minPassing);
  for (const p of problems) console.error(`test-floor: ${p}`);
  if (status !== 0) return status;
  if (problems.length) return 1;
  console.error(`test-floor: ${summary.pass} passed (floor ${minPassing})`);
  const notice = staleFloorNotice(summary, minPassing);
  if (notice) console.error(`test-floor: ${notice}`);
  return 0;
}

// Compare real paths: import.meta.url is resolved through symlinks, argv[1] is not, and
// a mismatch would skip main() and exit 0 without running anything.
const invokedAs = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedAs === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
