/**
 * Log volume (#246). Two per-cycle success lines ("background cycle complete" and
 * "Loaded monitors from Kuma") were 73 % of everything JagHelm logged, and every
 * unmatched container got its own line at boot. Steady state now logs at debug
 * only; a slow cycle, a change, a failure or a recovery still logs at info/warn,
 * once.
 *
 * LOG_LEVEL=debug (set before the imports, since the logger reads it at load) so
 * the debug lines are written and their level can be asserted. Tests in this file
 * share monitors.js module state (the last load, the once-per-boot flag) and run
 * in order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LOG_LEVEL = 'debug';
const { initMonitors, fetchMonitors, matchMonitor, logUnmatchedContainers } =
  await import('./monitors.js');
const {
  createCycleReporter,
  runCycleRefreshes,
  CYCLE_REFRESHES,
  refreshServices,
  refreshUPS,
  refreshGitea,
  refreshIntegrations,
} = await import('./refresh.js');

// A trusted loopback URL passes the SSRF guard; globalThis.fetch is stubbed, so
// nothing touches the network.
initMonitors('http://localhost:9999');

const realFetch = globalThis.fetch;

// Collect the structured logger's JSON lines while `fn` runs; anything else
// written to stdout/stderr (the test runner's own output) passes through.
async function captureLogs(fn) {
  const lines = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const tap = (orig) =>
    function (chunk, ...rest) {
      try {
        const obj = JSON.parse(String(chunk));
        if (obj && obj.module && obj.level) {
          lines.push(obj);
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(origOut);
  process.stderr.write = tap(origErr);
  try {
    await fn();
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return lines;
}

// Same shape as the stub in monitors.test.js: enough Response for safeFetch.
function mockResponse({ ok, body }) {
  return {
    ok,
    status: ok ? 200 : 503,
    headers: { get: () => null },
    body: null,
    json: async () => body,
  };
}

function statusPage(names) {
  return {
    publicGroupList: [{ monitorList: names.map((name, i) => ({ id: i + 1, name })) }],
    heartbeatList: Object.fromEntries(names.map((_, i) => [i + 1, [{ status: 1, ping: 5 }]])),
    uptimeList: {},
  };
}

async function loadMonitors(response) {
  globalThis.fetch = typeof response === 'function' ? response : async () => mockResponse(response);
  try {
    return await captureLogs(() => fetchMonitors(true));
  } finally {
    globalThis.fetch = realFetch;
  }
}

const atOrAbove = (lines, level) => {
  const rank = { debug: 0, info: 1, warn: 2, error: 3 };
  return lines.filter((l) => rank[l.level] >= rank[level]);
};

// ── background cycle ─────────────────────────────────────────────────────

function recordingLogger() {
  const entries = [];
  const rec = (level) => (fields, msg) => entries.push({ level, fields, msg });
  return {
    entries,
    logger: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') },
  };
}

test('cycle log: a healthy cycle logs nothing at info, only a debug line', () => {
  const { entries, logger } = recordingLogger();
  const report = createCycleReporter(logger);
  report({ ms: 371, errors: [] });
  report({ ms: 402, errors: [] });
  assert.deepEqual(
    entries.map((e) => e.level),
    ['debug', 'debug']
  );
  assert.equal(entries[0].msg, 'background cycle complete');
  assert.equal(entries[0].fields.ms, 371);
});

test('cycle log: a slow cycle (5 s or more) logs once at info, and the next fast one is quiet again', () => {
  const { entries, logger } = recordingLogger();
  const report = createCycleReporter(logger);
  report({ ms: 6200, errors: [] });
  report({ ms: 380, errors: [] });
  assert.deepEqual(
    entries.map((e) => e.level),
    ['info', 'debug']
  );
  assert.equal(entries[0].msg, 'background cycle complete');
  assert.equal(entries[0].fields.slow, true);
  assert.equal(entries[0].fields.ms, 6200);
});

test('cycle log: a changed error set logs once at info, and again when it clears', () => {
  const { entries, logger } = recordingLogger();
  const report = createCycleReporter(logger);
  report({ ms: 400, errors: ['gitea'] }); // new failure
  report({ ms: 400, errors: ['gitea'] }); // same failure: quiet
  report({ ms: 400, errors: ['integration:plex', 'gitea'] }); // one more
  report({ ms: 400, errors: ['gitea', 'integration:plex'] }); // same set, other order
  report({ ms: 400, errors: [] }); // recovery
  report({ ms: 400, errors: [] });
  assert.deepEqual(
    entries.map((e) => e.level),
    ['info', 'debug', 'info', 'debug', 'info', 'debug']
  );
  assert.deepEqual(entries[0].fields.added, ['gitea']);
  assert.deepEqual(entries[2].fields.added, ['integration:plex']);
  assert.deepEqual(entries[2].fields.errors, ['gitea', 'integration:plex']);
  assert.deepEqual(entries[4].fields.cleared, ['gitea', 'integration:plex']);
  assert.deepEqual(entries[4].fields.errors, []);
});

test('cycle errors: a failed refresh or an erroring integration joins the error set, under its own name', async () => {
  // Out of the usual order, so a label taken by position instead of from its
  // own pair would land on the wrong refresh.
  const errors = await runCycleRefreshes([
    ['integrations', async () => ({ plex: { _error: 'HTTP 401' }, sonarr: { queue: 0 } })],
    [
      'gitea',
      async () => {
        throw new Error('boom');
      },
    ],
    ['services', async () => ({ nodes: {} })],
    ['ups', async () => null], // refresh functions return null on error
  ]);
  assert.deepEqual(errors, ['gitea', 'integration:plex', 'ups']);
});

test('cycle errors: the background cycle runs all four refreshes, each under its name', () => {
  assert.deepEqual(CYCLE_REFRESHES, [
    ['services', refreshServices],
    ['ups', refreshUPS],
    ['gitea', refreshGitea],
    ['integrations', refreshIntegrations],
  ]);
});

// ── Kuma monitor load ────────────────────────────────────────────────────

test('monitors: the first load logs at info, an unchanged reload only at debug', async () => {
  const first = await loadMonitors({ ok: true, body: statusPage(['grafana']) });
  const loaded = first.filter((l) => l.msg === 'Loaded monitors from Kuma');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].level, 'info');
  assert.equal(loaded[0].count, 1);

  const again = await loadMonitors({ ok: true, body: statusPage(['grafana']) });
  assert.deepEqual(atOrAbove(again, 'info'), []);
  assert.equal(
    again.filter((l) => l.msg === 'Loaded monitors from Kuma' && l.level === 'debug').length,
    1
  );
});

test('monitors: a changed monitor count logs at info', async () => {
  const lines = await loadMonitors({ ok: true, body: statusPage(['grafana', 'gitea']) });
  const loaded = lines.filter((l) => l.msg === 'Loaded monitors from Kuma');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].level, 'info');
  assert.equal(loaded[0].count, 2);
});

test('monitors: Kuma going unavailable warns once per outage, and the recovery logs at info', async () => {
  const down1 = await loadMonitors({ ok: false, body: {} });
  const down2 = await loadMonitors({ ok: false, body: {} });
  const warns = [...down1, ...down2].filter((l) => l.level === 'warn');
  assert.equal(warns.length, 1, 'one warning for the whole outage');

  const back = await loadMonitors({ ok: true, body: statusPage(['grafana', 'gitea']) });
  const loaded = back.filter((l) => l.msg === 'Loaded monitors from Kuma');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].level, 'info', 'same count as before the outage, but a recovery is news');

  // A thrown fetch still logs its error every time (unchanged), and also counts
  // as an outage, so the next good load logs at info.
  const threw = await loadMonitors(async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.ok(threw.some((l) => l.level === 'error'));
  const back2 = await loadMonitors({ ok: true, body: statusPage(['grafana', 'gitea']) });
  assert.equal(back2.find((l) => l.msg === 'Loaded monitors from Kuma')?.level, 'info');
});

// ── unmatched containers ─────────────────────────────────────────────────

const MONITORS = {
  1: { id: 1, name: 'grafana', status: 'up' },
  2: { id: 2, name: 'gitea', status: 'up' },
};

test('matchMonitor: a container with no monitor logs nothing itself', async () => {
  const lines = await captureLogs(async () => {
    assert.equal(matchMonitor('watchtower', null, MONITORS), null);
    assert.equal(matchMonitor('alloy', null, MONITORS), null);
  });
  assert.deepEqual(lines, []);
});

test('unmatched containers: the summary waits until monitors and containers have loaded', async () => {
  const lines = await captureLogs(async () => {
    // Kuma down at boot: every container would look unmatched, so say nothing yet.
    assert.equal(
      logUnmatchedContainers({ unmatched: ['alloy', 'gitea'], containerCount: 2, monitors: {} }),
      false
    );
    // No containers discovered yet (Prometheus or cAdvisor not ready).
    assert.equal(
      logUnmatchedContainers({ unmatched: [], containerCount: 0, monitors: MONITORS }),
      false
    );
  });
  assert.deepEqual(lines, []);
});

test('unmatched containers: summarised in one line, once per boot', async () => {
  const lines = await captureLogs(async () => {
    assert.equal(
      logUnmatchedContainers({
        unmatched: ['watchtower', 'alloy'],
        containerCount: 5,
        monitors: MONITORS,
      }),
      true
    );
    assert.equal(
      logUnmatchedContainers({
        unmatched: ['watchtower', 'alloy', 'redis'],
        containerCount: 6,
        monitors: MONITORS,
      }),
      false
    );
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[0].count, 2);
  assert.deepEqual(lines[0].containers, ['alloy', 'watchtower']);
  assert.deepEqual(lines[0].monitors, ['gitea', 'grafana']);
});
