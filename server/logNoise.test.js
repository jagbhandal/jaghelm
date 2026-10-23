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
const { initMonitors, fetchMonitors, assignMonitors, checkMonitorMappings, logUnmatchedContainers } =
  await import('./monitors.js');
const {
  createCycleReporter,
  runCycleRefreshes,
  CYCLE_REFRESHES,
  refreshServices,
  refreshUPS,
  refreshIntegrations,
} = await import('./refresh.js');
const { refreshGitea } = await import('./gitea.js');

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

// #232: a Kuma outage logs the same pair as a Prometheus one, through the same
// source health log: one warning when it starts, one info line when it ends.
test('monitors: Kuma going unavailable warns once per outage, and the recovery logs one info line', async () => {
  const down1 = await loadMonitors({ ok: false, body: {} });
  const down2 = await loadMonitors({ ok: false, body: {} });
  const warns = atOrAbove([...down1, ...down2], 'warn');
  assert.equal(warns.length, 1, 'one warning for the whole outage');
  assert.equal(warns[0].source, 'kuma');
  assert.match(warns[0].error, /HTTP 503/);

  const back = await loadMonitors({ ok: true, body: statusPage(['grafana', 'gitea']) });
  const news = atOrAbove(back, 'info');
  assert.equal(news.length, 1, 'one line for the recovery');
  assert.equal(news[0].level, 'info');
  assert.equal(news[0].source, 'kuma');
  assert.equal(news[0].msg, 'data source recovered');
});

test('monitors: Kuma refusing every load logs one warning, not an error per cycle', async () => {
  const refused = async () => {
    throw new TypeError('fetch failed');
  };
  const lines = [...(await loadMonitors(refused)), ...(await loadMonitors(refused)), ...(await loadMonitors(refused))];
  const loud = atOrAbove(lines, 'warn');
  assert.equal(loud.length, 1, 'a second thrown fetch logs nothing at warn or above');
  assert.equal(loud[0].level, 'warn');
  assert.equal(loud[0].source, 'kuma');

  const back = await loadMonitors({ ok: true, body: statusPage(['grafana', 'gitea']) });
  assert.deepEqual(
    atOrAbove(back, 'info').map((l) => `${l.level} ${l.msg}`),
    ['info data source recovered']
  );
});

// ── unmatched containers ─────────────────────────────────────────────────

const MONITORS = {
  1: { id: 1, name: 'grafana', status: 'up' },
  2: { id: 2, name: 'gitea', status: 'up' },
};

const candidates = (...names) => names.map((container) => ({ container, nodeKey: 'vm103' }));

test('assignMonitors: a container with no monitor logs nothing itself', async () => {
  const lines = await captureLogs(async () => {
    assert.deepEqual(assignMonitors({ candidates: candidates('watchtower', 'alloy'), monitors: MONITORS }), [null, null]);
  });
  assert.deepEqual(lines, []);
});

// #240: a mapping to a monitor Kuma lacks is one problem, so one warning,
// however many refresh cycles it stays broken.
test('assignMonitors: a mapping to a missing monitor warns once per mapping, not per cycle', async () => {
  const services = {
    tailscale: { monitor: 'Tailscale' },
    'gateway-npm': { monitor: 'Nginx Proxy Manager' },
    gitea: { monitor: 'gitea' },
  };
  const cycle = (...names) => assignMonitors({ candidates: candidates(...names), monitors: MONITORS, services });
  const lines = await captureLogs(async () => {
    for (let i = 0; i < 3; i += 1) cycle('tailscale', 'gitea', 'grafana');
    cycle('tailscale', 'gateway-npm'); // a second broken mapping appears
    cycle('tailscale', 'gateway-npm');
    // One plain mapping on two nodes is one mapping: no second warning.
    assignMonitors({ candidates: [{ container: 'tailscale', nodeKey: 'pi2' }], monitors: MONITORS, services });
  });
  assert.deepEqual(
    lines.map((l) => `${l.level} ${l.containerName} -> ${l.explicitMonitor} (${l.setting})`),
    ['warn tailscale -> Tailscale (monitor)', 'warn gateway-npm -> Nginx Proxy Manager (monitor)']
  );
  assert.match(lines[0].msg, /names no Kuma monitor, or a paused one/);
  assert.match(lines[0].msg, /shows no monitor until/);
});

test('assignMonitors: a per-node mapping to a missing monitor warns once, naming its node', async () => {
  const services = { 'gateway-npm': { monitor_per_node: { pi1: 'NPM Pi Primary', pi2: 'NPM Pi Second' } } };
  const lines = await captureLogs(async () => {
    for (let i = 0; i < 3; i += 1) {
      assignMonitors({
        candidates: [
          { container: 'gateway-npm', nodeKey: 'pi1' },
          { container: 'gateway-npm', nodeKey: 'pi2' },
        ],
        monitors: { 1: { id: 1, name: 'NPM Pi Primary', status: 'up' } },
        services,
      });
    }
  });
  assert.deepEqual(
    lines.map((l) => `${l.containerName} -> ${l.explicitMonitor} (${l.setting})`),
    ['gateway-npm -> NPM Pi Second (monitor_per_node.pi2)']
  );
});

test('assignMonitors: monitor: false is quiet', async () => {
  const lines = await captureLogs(async () => {
    const result = assignMonitors({
      candidates: candidates('gateway-tunnel'),
      monitors: MONITORS,
      services: { 'gateway-tunnel': { monitor: false } },
    });
    assert.deepEqual(result, [null]);
  });
  assert.deepEqual(lines, []);
});

test('assignMonitors: no mapping warning while Kuma has given no monitors', async () => {
  const lines = await captureLogs(async () => {
    const result = assignMonitors({
      candidates: candidates('radarr'),
      monitors: {},
      services: { radarr: { monitor: 'Radarr' } },
    });
    assert.deepEqual(result, [null]);
  });
  assert.deepEqual(lines, [], 'every mapping would look broken during a Kuma outage');
});

// A hand-edited services.yaml: the save route's schema never saw it.
test('checkMonitorMappings: an unknown node key or a wrong type warns once each', async () => {
  const services = {
    'gateway-npm': { monitor_per_node: { pi1: 'NPM Pi Primary', pi3: 'NPM Pi Secondary' } },
    vaultwarden: { monitor_per_node: { vm103: 'Vaultwarden' } },
    dockge: { monitor: 7, monitor_per_node: 'vm101' },
    gitea: { monitor: false, monitor_per_node: { vm103: ['Gitea'] } },
    tailscale: null,
  };
  const lines = await captureLogs(async () => {
    for (let i = 0; i < 3; i += 1) checkMonitorMappings(services, ['vm101', 'vm103', 'pi2', 'pi1']);
  });
  assert.deepEqual(
    lines.map((l) => `${l.level} ${l.containerName} ${l.nodeKey ?? l.setting}`),
    [
      'warn gateway-npm pi3',
      'warn dockge monitor',
      'warn dockge monitor_per_node',
      'warn gitea monitor_per_node.vm103',
    ]
  );
  assert.match(lines[0].msg, /not under nodes:/);
});

test('checkMonitorMappings: with no node list, only the types are checked', async () => {
  const lines = await captureLogs(async () => {
    checkMonitorMappings({ haproxy: { monitor_per_node: { 'no-such-node': 'HAProxy' } } }, null);
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
