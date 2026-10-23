/**
 * The history charts' reads (#311, promHistory.js): which requests are
 * refused, what Prometheus is asked, how its matrix becomes lines, and the
 * cache that keeps every reader within one step on one query.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FAILURE_TTL_MS,
  HISTORY_RANGES,
  HISTORY_SERIES,
  createHistoryCache,
  linesOf,
  parseHistoryQuery,
  rangeWindow,
  resolveEntity,
} from './promHistory.js';

// The containers the server has seen, by node: what resolveEntity looks a name up in.
const KNOWN = { nas: ['web.1'], pve: ['db', 'immich_server'] };
const known = (node) => new Set(KNOWN[node] ?? []);

const CONFIG = {
  nodes: {
    pve: { display_name: 'Proxmox' },
    nas: { prometheus_node: 'storage-box' },
    old: { visible: false },
  },
};

// 2026-10-20 09:00:30 UTC: half a minute past a 1h step, 30 s into a 5-minute one.
const NOW = Date.UTC(2026, 9, 20, 9, 0, 30);

// ── The request ───────────────────────────────────────────────────────────

test('an unknown series, an unknown range or a missing one is refused', () => {
  for (const query of [
    {},
    { series: '', range: '1h' },
    { series: 'node.load', range: '1h' },
    { series: 'node.cpu,up', range: '1h' },
    { series: 'node.cpu', range: '30d' },
    { series: 'node.cpu' },
    { series: 'node.cpu', range: ['1h'] },
    { series: ['node.cpu'], range: '1h' },
  ]) {
    const out = parseHistoryQuery(query);
    assert.equal(out.ok, false, JSON.stringify(query));
    assert.equal(out.status, 400);
    assert.match(out.error, /series|range/i);
  }
});

test('a malformed entity is refused, for each kind of series', () => {
  const bad = [
    ['node.cpu', ''],
    ['node.cpu', 'x'.repeat(201)],
    ['node.cpu', 'pve\n'],
    ['node.cpu', 'apps/jellyfin'],
    ['node.cpu', ['pve']],
    ['container.cpu', 'jellyfin'],
    ['container.cpu', '/jellyfin'],
    ['container.cpu', 'apps/'],
  ];
  for (const [series, entity] of bad) {
    const out = parseHistoryQuery({ series, entity, range: '1h' });
    assert.deepEqual([out.ok, out.status], [false, 400], `${series} ${JSON.stringify(entity)}`);
    assert.match(out.error, /entity/i);
  }
});

test('a container series needs an entity; node and container series are asked apart; four at most', () => {
  assert.match(
    parseHistoryQuery({ series: 'container.cpu', range: '1h' }).error,
    /needs an entity/
  );
  assert.match(
    parseHistoryQuery({ series: 'node.cpu,container.cpu', entity: 'apps', range: '1h' }).error,
    /separately/
  );
  assert.equal(
    parseHistoryQuery({ series: 'node.cpu,node.memory,node.disk,node.temperature', range: '1h' })
      .ok,
    true
  );
  // Five names, though only four series exist for a node, so with a repeat.
  assert.equal(
    parseHistoryQuery({
      series: 'node.cpu,node.memory,node.disk,node.temperature,node.cpu',
      range: '1h',
    }).ok,
    true,
    'a repeat counts once'
  );
});

test('a good request: the distinct series in order, the entity, the range', () => {
  assert.deepEqual(
    parseHistoryQuery({ series: 'node.memory, node.cpu,node.memory', range: '7d' }),
    {
      ok: true,
      series: ['node.memory', 'node.cpu'],
      entity: null,
      range: '7d',
    }
  );
  assert.deepEqual(
    parseHistoryQuery({ series: 'container.memory', entity: 'apps/paperless-ngx', range: '24h' }),
    { ok: true, series: ['container.memory'], entity: 'apps/paperless-ngx', range: '24h' }
  );
  // A node key may hold a slash-free anything; a container's node part too.
  assert.equal(
    parseHistoryQuery({ series: 'container.cpu', entity: 'my node/web.1', range: '1h' }).ok,
    true
  );
});

// ── What Prometheus is asked ──────────────────────────────────────────────

test('each range ends on a whole step and is at most a few hundred points', () => {
  assert.deepEqual(rangeWindow('1h', NOW), {
    start: Date.UTC(2026, 9, 20, 8, 0) / 1000,
    end: Date.UTC(2026, 9, 20, 9, 0) / 1000,
    step: 60,
    count: 61,
  });
  assert.equal(rangeWindow('24h', NOW).count, 289);
  assert.equal(rangeWindow('7d', NOW).count, 337);
  assert.equal(rangeWindow('7d', NOW).end, Date.UTC(2026, 9, 20, 9, 0) / 1000);
  for (const [name, { seconds, step }] of Object.entries(HISTORY_RANGES)) {
    assert.ok(seconds / step + 1 <= 400, name);
  }
});

test("the entity is matched by the node's Prometheus label; a node services.yaml lacks is a 404", () => {
  const all = resolveEntity({ kind: 'node', entity: null }, CONFIG);
  assert.equal(all.matcher, 'node=~"pve|storage-box"', 'the visible nodes, by label');
  assert.deepEqual(all.keys, ['pve', 'nas']);
  assert.deepEqual(all.lineOf({ node: 'storage-box' }), ['nas']);

  const one = resolveEntity({ kind: 'node', entity: 'nas' }, CONFIG);
  assert.equal(one.matcher, 'node=~"storage-box"');
  assert.deepEqual(one.lineOf({ node: 'storage-box' }), ['nas']);
  assert.deepEqual(one.lineOf({ node: 'pve' }), []);
  assert.equal(
    resolveEntity({ kind: 'node', entity: 'old' }, CONFIG).ok,
    true,
    'a hidden node by name'
  );

  const box = resolveEntity({ kind: 'container', entity: 'nas/web.1' }, CONFIG, known);
  assert.equal(box.matcher, 'node="storage-box",name="web.1"');
  assert.deepEqual(box.lineOf({ name: 'web.1' }), ['nas/web.1']);

  for (const [kind, entity] of [
    ['node', 'pi9'],
    ['container', 'pi9/web'],
    ['node', 'toString'],
  ]) {
    assert.deepEqual(resolveEntity({ kind, entity }, CONFIG, known), {
      ok: false,
      status: 404,
      error: 'No node by that name in services.yaml',
    });
  }
});

test("a container the server hasn't seen on that node is a 404, whatever its name", () => {
  for (const entity of [
    'nas/db', // seen, but on another node
    'nas/WEB.1',
    'nas/made-up',
    'nas/has space',
    'nas/a"} or vector(1) or {"',
    'nas/.*',
    'nas/web.1\\',
    'nas/{name=~".+"}',
  ]) {
    assert.deepEqual(
      resolveEntity({ kind: 'container', entity }, CONFIG, known),
      { ok: false, status: 404, error: 'No container by that name on that node' },
      entity
    );
  }
});

test('each query reads its window and groups by what names its line', () => {
  const m = 'node=~"pve"';
  for (const [name, { kind, query }] of Object.entries(HISTORY_SERIES)) {
    const q = query(m, '5m');
    assert.ok(q.includes(m), `${name} matches its entity`);
    assert.match(q, kind === 'node' ? /by \(node\)/ : /by \(name\)/, name);
    if (name !== 'node.disk') assert.ok(q.includes('[5m]'), `${name} reads its window`);
  }
  // The disk is `/` where there is one, else the largest filesystem.
  const disk = HISTORY_SERIES['node.disk'].query(m, '5m');
  assert.match(disk, /mountpoint="\/"/);
  assert.match(disk, / or max by \(node\)/);
  assert.match(disk, /group_left max by \(node\) \(node_filesystem_size_bytes/);
});

// ── The answer ────────────────────────────────────────────────────────────

test('a matrix becomes one value per step, null where Prometheus has no point, rounded', () => {
  const start = 1000;
  const lines = linesOf(
    [
      {
        metric: { node: 'pve' },
        values: [
          [1000, '12.34'],
          [1120, '13.96'],
          [1180, 'NaN'],
        ],
      },
      { metric: { node: 'gone' }, values: [[1000, '1']] },
    ],
    {
      start,
      step: 60,
      count: 4,
      unit: '%',
      lineOf: (metric) => (metric.node === 'pve' ? ['pve'] : []),
      keys: ['pve', 'nas'],
    }
  );
  assert.deepEqual(lines, [{ entity: 'pve', values: [12.3, null, 14, null] }]);
  const bytes = linesOf([{ metric: { name: 'db' }, values: [[0, '1048576.6']] }], {
    start: 0,
    step: 60,
    count: 1,
    unit: 'bytes',
    lineOf: () => ['apps/db'],
    keys: ['apps/db'],
  });
  assert.deepEqual(bytes, [{ entity: 'apps/db', values: [1048577] }]);
});

/** A cache over a fake Prometheus: `asked` holds each query, `answer` gives its matrix. */
function harness({ answer = () => [] } = {}) {
  const clock = { now: NOW };
  const asked = [];
  const logged = [];
  const logger = {
    warn: (fields, msg) => logged.push(['warn', msg, fields]),
    info: (fields, msg) => logged.push(['info', msg, fields]),
  };
  const cache = createHistoryCache({
    now: () => clock.now,
    known,
    logger,
    queryRange: async (query, window) => {
      asked.push({ query, window });
      return answer(query, window);
    },
  });
  return { cache, asked, clock, logged };
}

const parsed = (query) => {
  const out = parseHistoryQuery(query);
  assert.ok(out.ok, out.error);
  return out;
};

test('the answer: each series with its unit, start, step and lines', async () => {
  const { cache, asked } = harness({
    answer: (q, { start }) =>
      q.includes('node_cpu') ? [{ metric: { node: 'pve' }, values: [[start, '7.25']] }] : [],
  });
  const out = await cache.answer(
    parsed({ series: 'node.cpu,node.temperature', entity: 'pve', range: '1h' }),
    CONFIG
  );
  assert.equal(out.status, 200);
  const start = Date.UTC(2026, 9, 20, 8, 0);
  assert.deepEqual(out.body, {
    range: '1h',
    entity: 'pve',
    series: [
      {
        series: 'node.cpu',
        unit: '%',
        startMs: start,
        stepMs: 60_000,
        count: 61,
        ok: true,
        lines: [{ entity: 'pve', values: [7.3, ...new Array(60).fill(null)] }],
      },
      {
        series: 'node.temperature',
        unit: '°C',
        startMs: start,
        stepMs: 60_000,
        count: 61,
        ok: true,
        lines: [],
      },
    ],
  });
  assert.deepEqual(asked[0].window, { start: start / 1000, end: start / 1000 + 3600, step: 60 });
});

test('a second read within the step asks Prometheus nothing; the next step asks again', async () => {
  const { cache, asked, clock } = harness();
  const req = parsed({ series: 'node.cpu', range: '1h' });
  const first = await cache.answer(req, CONFIG);
  const second = await cache.answer(req, CONFIG);
  assert.equal(asked.length, 1);
  assert.equal(second.body.series[0], first.body.series[0], 'the same answer, kept');
  clock.now += 29_000; // still 09:00:59
  await cache.answer(req, CONFIG);
  assert.equal(asked.length, 1);
  clock.now += 1_000; // 09:01:00: a new step
  await cache.answer(req, CONFIG);
  assert.equal(asked.length, 2);
  // Another entity or range is another question.
  await cache.answer(parsed({ series: 'node.cpu', entity: 'pve', range: '1h' }), CONFIG);
  await cache.answer(parsed({ series: 'node.cpu', range: '24h' }), CONFIG);
  assert.equal(asked.length, 4);
});

test('reads that arrive while one is asked share its query', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { cache, asked } = harness({ answer: () => gate.then(() => []) });
  const req = parsed({ series: 'container.memory', entity: 'pve/db', range: '7d' });
  const reads = [cache.answer(req, CONFIG), cache.answer(req, CONFIG), cache.answer(req, CONFIG)];
  release();
  const answers = await Promise.all(reads);
  assert.equal(asked.length, 1);
  assert.ok(answers.every((a) => a.status === 200 && a.body.series[0].ok));
});

test('Prometheus failing: the series says so, never an empty line; it is asked again after a while', async () => {
  let down = true;
  const { cache, asked, clock } = harness({
    answer: () => {
      if (down) throw new Error('Prometheus answered HTTP 502');
      return [];
    },
  });
  const req = parsed({ series: 'node.cpu', range: '24h' });
  const out = await cache.answer(req, CONFIG);
  assert.equal(out.status, 200);
  assert.equal(out.body.series[0].ok, false);
  assert.equal(out.body.series[0].error, 'Prometheus answered with an error (HTTP 502)');
  assert.equal('lines' in out.body.series[0], false);
  await cache.answer(req, CONFIG);
  assert.equal(asked.length, 1, 'the failure is kept for a while');
  down = false;
  clock.now += FAILURE_TTL_MS;
  const back = await cache.answer(req, CONFIG);
  assert.equal(asked.length, 2);
  assert.equal(back.body.series[0].ok, true);
});

test('with no node to chart, nothing is asked; a node services.yaml lacks is a 404', async () => {
  const { cache, asked } = harness();
  const none = await cache.answer(parsed({ series: 'node.cpu', range: '1h' }), { nodes: {} });
  assert.deepEqual(none.body.series[0].lines, []);
  assert.equal(none.body.series[0].ok, true);
  const missing = await cache.answer(
    parsed({ series: 'node.cpu', entity: 'pi9', range: '1h' }),
    CONFIG
  );
  assert.deepEqual(missing, {
    status: 404,
    body: { error: 'No node by that name in services.yaml' },
  });
  assert.equal(asked.length, 0);
});

test('made-up containers on a known node: 404s that ask Prometheus nothing and keep nothing', async () => {
  const { cache, asked } = harness();
  const real = parsed({ series: 'container.cpu', entity: 'pve/db', range: '1h' });
  await cache.answer(real, CONFIG);
  assert.deepEqual([asked.length, cache.size()], [1, 1]);
  for (let i = 0; i < 250; i += 1) {
    const out = await cache.answer(
      parsed({ series: 'container.cpu,container.memory', entity: `pve/fake-${i}`, range: '1h' }),
      CONFIG
    );
    assert.equal(out.status, 404);
  }
  for (const entity of ['pve/a"} or vector(1) or {"', 'pve/.*', 'pve/{name=~".+"}', 'pve/DB']) {
    const out = await cache.answer(
      parsed({ series: 'container.cpu', entity, range: '7d' }),
      CONFIG
    );
    assert.deepEqual(out, {
      status: 404,
      body: { error: 'No container by that name on that node' },
    });
  }
  assert.deepEqual([asked.length, cache.size()], [1, 1], 'no query, no entry, the real one kept');
  await cache.answer(real, CONFIG);
  assert.equal(asked.length, 1, "the real container's answer is still cached");
  // The query names the server's container, matched exactly.
  assert.match(asked[0].query, /node="pve",name="db"/);
});

test('a failure goes out as the sentence a failed Prometheus says everywhere (#605), never its words or a fetch error', async () => {
  const cases = [
    [
      Object.assign(new Error('Prometheus returned no query result: parse error at char 3'), {
        failure: 'rejected',
      }),
      'Prometheus refused the query',
    ],
    [Object.assign(new Error('Prometheus answered HTTP 422'), { status: 422 }), 'Prometheus refused the query (HTTP 422)'],
    [
      Object.assign(new Error('Prometheus answered HTTP 503'), { status: 503 }),
      'Prometheus answered with an error (HTTP 503)',
    ],
    [
      new Error('Prometheus query failed: fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:9090'), { code: 'ECONNREFUSED' }),
      }),
      'Prometheus refused the connection',
    ],
    [new DOMException('The operation was aborted due to timeout', 'TimeoutError'), "Prometheus didn't answer in time"],
    [
      // A refused PROMETHEUS_URL (#419): off, as the board's issue says, not "not set up".
      Object.assign(new Error('PROMETHEUS_URL carries a user name or password, so it is not used'), {
        failure: 'off',
      }),
      'Prometheus is off: its URL is refused',
    ],
    [
      Object.assign(new Error('No Prometheus is set up (PROMETHEUS_URL)'), { failure: 'unset' }),
      'No Prometheus is set up',
    ],
  ];
  for (const [err, sentence] of cases) {
    const { cache } = harness({
      answer: () => {
        throw err;
      },
    });
    const out = await cache.answer(parsed({ series: 'node.cpu', range: '1h' }), CONFIG);
    assert.equal(out.body.series[0].error, sentence, err.message);
    assert.doesNotMatch(JSON.stringify(out.body), /ECONNREFUSED|10\.0\.0\.9|parse error|aborted/);
  }
});

test('a failure’s detail is logged once when it starts, and once when Prometheus answers again', async () => {
  let failure = Object.assign(
    new Error('Prometheus answered HTTP 400: bad_data: secret-looking text'),
    {
      status: 400,
    }
  );
  const { cache, logged, clock } = harness({
    answer: () => {
      if (failure) throw failure;
      return [];
    },
  });
  const reads = [
    { series: 'node.cpu', range: '1h' },
    { series: 'node.disk', entity: 'pve', range: '24h' },
    { series: 'container.memory', entity: 'pve/db', range: '7d' },
  ];
  for (const q of reads) {
    const out = await cache.answer(parsed(q), CONFIG);
    assert.equal(out.body.series[0].error, 'Prometheus refused the query (HTTP 400)');
    assert.ok(!JSON.stringify(out.body).includes('secret-looking'), 'the detail never goes out');
  }
  clock.now += FAILURE_TTL_MS;
  await cache.answer(parsed(reads[0]), CONFIG);
  assert.deepEqual(
    logged.map(([level, , fields]) => [level, fields.err]),
    [['warn', 'Prometheus answered HTTP 400: bad_data: secret-looking text']],
    'one line for the whole outage'
  );
  failure = null;
  clock.now += FAILURE_TTL_MS;
  await cache.answer(parsed(reads[0]), CONFIG);
  await cache.answer(parsed(reads[1]), CONFIG);
  assert.deepEqual(
    logged.map(([level]) => level),
    ['warn', 'info'],
    'and one when it answers again'
  );
});

test('a failure is logged again when its cause changes, not when only its detail does (#605)', async () => {
  let failure = null;
  const { cache, logged, clock } = harness({
    answer: () => {
      throw failure;
    },
  });
  const refused = (port) =>
    new Error('Prometheus query failed: fetch failed', {
      cause: Object.assign(new Error(`connect ECONNREFUSED 10.0.0.9:${port}`), { code: 'ECONNREFUSED' }),
    });
  const read = async () => {
    clock.now += FAILURE_TTL_MS;
    await cache.answer(parsed({ series: 'node.cpu', range: '1h' }), CONFIG);
  };
  failure = refused(9090);
  await read();
  failure = refused(9091);
  await read();
  failure = Object.assign(new Error('Prometheus answered HTTP 503'), { status: 503 });
  await read();
  assert.deepEqual(
    logged.map(([level, , fields]) => [level, fields.err]),
    [
      ['warn', 'Prometheus query failed: fetch failed: connect ECONNREFUSED 10.0.0.9:9090'],
      ['warn', 'Prometheus answered HTTP 503'],
    ]
  );
});
