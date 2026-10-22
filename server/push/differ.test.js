import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alertStateKey, diffSnapshots, RECOVERY_TYPES, SEVERITY } from './differ.js';

const EMPTY = { services: {}, hosts: {}, ups: { state: 'unknown' }, cron: {}, sources: {} };

test('exports SEVERITY map covering all event types', () => {
  assert.equal(SEVERITY.service_down, 'critical');
  assert.equal(SEVERITY.service_recovered, 'info');
  assert.equal(SEVERITY.host_unreachable, 'critical');
  assert.equal(SEVERITY.host_recovered, 'info');
  assert.equal(SEVERITY.host_threshold, 'warning');
  assert.equal(SEVERITY.host_threshold_cleared, 'info');
  assert.equal(SEVERITY.ups_on_battery, 'critical');
  assert.equal(SEVERITY.ups_restored, 'info');
  assert.equal(SEVERITY.cron_failed, 'warning');
  assert.equal(SEVERITY.cron_recovered, 'info');
  assert.equal(SEVERITY.cron_overdue, 'warning');
  assert.equal(SEVERITY.source_down, 'warning');
  assert.equal(SEVERITY.source_recovered, 'info');
});

test('RECOVERY_TYPES is the info-severity types plus the Arcane recoveries', () => {
  assert.ok(RECOVERY_TYPES instanceof Set);
  const expected = [
    'service_recovered',
    'host_recovered',
    'host_threshold_cleared',
    'ups_restored',
    'cron_recovered',
    'source_recovered',
    // Built outside the snapshot differ (by the Arcane poller) but semantically
    // recoveries, so they join the set to be gated by notifyRecoveries.
    'arcane_cleared',
    'arcane_agent_recovered',
  ].sort();
  assert.deepEqual([...RECOVERY_TYPES].sort(), expected);
  for (const [type, sev] of Object.entries(SEVERITY)) {
    assert.equal(RECOVERY_TYPES.has(type), sev === 'info');
  }
});

test('#448: no previous snapshot (prev=null) is diffed as an empty one: what is in trouble pages, what is ok does not', () => {
  assert.deepEqual(diffSnapshots(null, EMPTY), []);
  const populated = {
    services: { 'n1:web': 'down', 'n1:api': 'up', 'n1:db': 'unknown' },
    hosts: {
      n1: { reachable: false, levels: { cpu: 'warn', disk: 'crit' } },
      n2: { reachable: true, levels: { cpu: 'ok', disk: 'crit', mem: 'warn' } },
      n3: { reachable: true, levels: { cpu: 'ok', disk: 'ok' } },
    },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure', 'n1:prune': 'overdue', 'n1:rotate': 'success' },
    sources: { prometheus: 'down', kuma: 'ok', nut: 'failing' },
  };
  const sent = diffSnapshots(null, populated).map((e) => `${e.type} ${e.id} ${e.severity}`);
  assert.deepEqual(sent, [
    'cron_failed n1:backup warning',
    'cron_overdue n1:prune warning',
    'host_threshold n2:disk critical',
    'host_threshold n2:mem warning',
    'host_unreachable n1 critical',
    'service_down n1:web critical',
    'source_down prometheus warning',
    'ups_on_battery ups critical',
  ]);
  assert.deepEqual(diffSnapshots(null, populated), diffSnapshots(EMPTY, populated));
});

test('no change: identical prev/next returns []', () => {
  const snap = {
    services: { 'n1:web': 'up' },
    hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'warn', mem: 'ok' } } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
    sources: { kuma: 'down', prometheus: 'ok' },
  };
  assert.deepEqual(diffSnapshots(snap, snap), []);
});

function svc(map) {
  return { ...EMPTY, services: map };
}

test('service up->down emits service_down(critical)', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'up' }), svc({ 'n1:web': 'down' }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'service_down',
    id: 'n1:web',
    node: 'n1',
    title: 'Service down',
    // With no model, the key stands in for the name; a service key's reason is
    // always its Kuma state.
    body: 'web on n1 · Kuma: down',
    severity: 'critical',
    reason: 'Kuma: down',
    prev: 'up',
    next: 'down',
  });
});

test('service unknown->down emits service_down', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'unknown' }), svc({ 'n1:web': 'down' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

test('service down->up emits service_recovered(info)', () => {
  const events = diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'up' }));
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].type, events[0].title, events[0].severity, events[0].prev, events[0].next],
    ['service_recovered', 'Service recovered', 'info', 'down', 'up']
  );
});

test('service down->unknown emits nothing (unknown never emits)', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'unknown' })), []);
});

test('service up->up and down->down emit nothing', () => {
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'up' }), svc({ 'n1:web': 'up' })), []);
  assert.deepEqual(diffSnapshots(svc({ 'n1:web': 'down' }), svc({ 'n1:web': 'down' })), []);
});

test('service new key in next (no prev entry) treated as prev=unknown', () => {
  const events = diffSnapshots(svc({}), svc({ 'n1:web': 'down' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'service_down');
  assert.equal(events[0].prev, 'unknown');
});

// ── Words: each event says what the model says ─────────────────────────────

const STATUS = {
  entities: [
    {
      id: 'services/n1:web',
      kind: 'service',
      name: 'Web',
      node: 'n1',
      state: 'crit',
      word: 'Down',
      reason: 'Kuma: down',
    },
    {
      id: 'nodes/n1',
      kind: 'node',
      name: 'Node One',
      node: 'n1',
      state: 'warn',
      word: 'Warning',
      reason: 'Disk 92 % (warning above 90 %)',
    },
    {
      id: 'power/ups',
      kind: 'ups',
      name: 'Back-UPS',
      state: 'crit',
      word: 'On battery',
      reason: 'On battery (80 % charge)',
    },
    {
      id: 'jobs/n1:backup',
      kind: 'job',
      name: 'backup',
      node: 'n1',
      state: 'warn',
      word: 'Failed',
      reason: 'Last run failed: exit 1',
    },
  ],
  issues: [
    {
      id: 'sources/prometheus',
      kind: 'source',
      name: 'Prometheus',
      state: 'warn',
      word: 'Failed',
      reason: 'HTTP 500',
    },
  ],
};

test("words: the title says what happened, the body names the entity and gives the model's reason", () => {
  const prev = {
    services: { 'n1:web': 'up' },
    hosts: { n1: { reachable: true, levels: { disk: 'ok' } } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
    sources: { prometheus: 'failing' },
  };
  const next = {
    services: { 'n1:web': 'down' },
    hosts: { n1: { reachable: true, levels: { disk: 'warn' } } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
    sources: { prometheus: 'down' },
  };
  assert.deepEqual(
    diffSnapshots(prev, next, STATUS).map((e) => [e.type, e.title, e.body, e.reason]),
    [
      [
        'cron_failed',
        'Cron job failed',
        'backup on n1 · Last run failed: exit 1',
        'Last run failed: exit 1',
      ],
      [
        'host_threshold',
        'Host disk high',
        'Node One · Disk 92 % (warning above 90 %)',
        'Disk 92 % (warning above 90 %)',
      ],
      ['service_down', 'Service down', 'Web on n1 · Kuma: down', 'Kuma: down'],
      ['source_down', 'Monitoring source down', 'Prometheus · HTTP 500', 'HTTP 500'],
      [
        'ups_on_battery',
        'UPS on battery',
        'Back-UPS · On battery (80 % charge)',
        'On battery (80 % charge)',
      ],
    ]
  );
});

test('words: a key the model judges as no service (an up entry a breadcrumb shares, #390) says the Kuma state', () => {
  const status = {
    entities: [
      {
        id: 'services/n1:nas-ui',
        kind: 'container',
        name: 'Nas Ui',
        state: 'crit',
        reason: 'Missing',
      },
    ],
  };
  const [event] = diffSnapshots(svc({ 'n1:nas-ui': 'down' }), svc({ 'n1:nas-ui': 'up' }), status);
  assert.deepEqual(
    [event.type, event.body, event.reason],
    ['service_recovered', 'Nas Ui on n1 · Kuma: up', 'Kuma: up']
  );
});

// ── Hosts: reachability ──────────────────────────────────────────────────

function host(map) {
  return { ...EMPTY, hosts: map };
}
const OK = { reachable: true, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } };
const DOWN = { reachable: false, levels: { cpu: 'ok', disk: 'ok', mem: 'ok' } };

test('host reachable true->false emits host_unreachable(critical)', () => {
  const events = diffSnapshots(host({ n1: OK }), host({ n1: DOWN }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'host_unreachable',
    id: 'n1',
    node: 'n1',
    title: 'Host unreachable',
    body: 'n1',
    severity: 'critical',
    reason: undefined,
    prev: true,
    next: false,
  });
});

test('host reachable false->true emits host_recovered(info)', () => {
  const events = diffSnapshots(host({ n1: DOWN }), host({ n1: OK }));
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].type, events[0].title, events[0].severity, events[0].prev, events[0].next],
    ['host_recovered', 'Host recovered', 'info', false, true]
  );
});

test('host reachable unchanged emits nothing', () => {
  assert.deepEqual(diffSnapshots(host({ n1: OK }), host({ n1: OK })), []);
  assert.deepEqual(diffSnapshots(host({ n1: DOWN }), host({ n1: DOWN })), []);
});

test('#448: a host new to the snapshot at ok sends nothing (no "Host recovered")', () => {
  assert.deepEqual(diffSnapshots(host({}), host({ n1: OK })), []);
  assert.deepEqual(diffSnapshots(host({ n0: OK }), host({ n0: OK, n1: OK })), []);
});

test('#448: a host new to the snapshot that is unreachable sends host_unreachable (critical)', () => {
  const events = diffSnapshots(host({}), host({ n1: DOWN }));
  assert.deepEqual(
    events.map((e) => [e.type, e.id, e.severity, e.prev, e.next]),
    [['host_unreachable', 'n1', 'critical', null, false]]
  );
});

test('#448: a host new to the snapshot sends host_threshold for each reading over its line, at its level', () => {
  const next = host({
    n1: { reachable: true, levels: { cpu: 'ok', disk: 'crit', mem: 'warn', 'pool:tank': 'warn' } },
  });
  assert.deepEqual(sentFor(host({}), next), [
    'host_threshold n1:disk critical null->crit',
    'host_threshold n1:mem warning null->warn',
    'host_threshold n1:pool:tank warning null->warn',
  ]);
  assert.deepEqual(
    diffSnapshots(host({}), next).map((e) => e.title),
    ['Host disk critical', 'Host memory high', 'Host storage pool tank high']
  );
});

test('#448: a host known to be unreachable stays quiet while it stays so (it is not new)', () => {
  assert.deepEqual(diffSnapshots(host({ n1: DOWN }), host({ n1: DOWN })), []);
});

// ── Hosts: the model's levels ────────────────────────────────────────────

const levels = (prev, next) => [
  host({ n1: { reachable: true, levels: prev } }),
  host({ n1: { reachable: true, levels: next } }),
];
const sentFor = (prev, next) =>
  diffSnapshots(prev, next).map((e) => `${e.type} ${e.id} ${e.severity} ${e.prev}->${e.next}`);

test('a level that rises sends host_threshold: warning for warn, critical for crit', () => {
  assert.deepEqual(sentFor(...levels({ cpu: 'ok' }, { cpu: 'warn' })), [
    'host_threshold n1:cpu warning ok->warn',
  ]);
  assert.deepEqual(sentFor(...levels({ disk: 'ok' }, { disk: 'crit' })), [
    'host_threshold n1:disk critical ok->crit',
  ]);
  assert.deepEqual(sentFor(...levels({ disk: 'warn' }, { disk: 'crit' })), [
    'host_threshold n1:disk critical warn->crit',
  ]);
  assert.deepEqual(
    diffSnapshots(...levels({ temp: 'ok' }, { temp: 'crit' })).map((e) => e.title),
    ['Host temperature critical']
  );
});

test('a level back to ok sends host_threshold_cleared; crit falling to warn sends nothing', () => {
  assert.deepEqual(sentFor(...levels({ mem: 'warn' }, { mem: 'ok' })), [
    'host_threshold_cleared n1:mem info warn->ok',
  ]);
  assert.deepEqual(sentFor(...levels({ disk: 'crit' }, { disk: 'ok' })), [
    'host_threshold_cleared n1:disk info crit->ok',
  ]);
  assert.deepEqual(sentFor(...levels({ disk: 'crit' }, { disk: 'warn' })), []);
  assert.deepEqual(
    diffSnapshots(...levels({ mem: 'warn' }, { mem: 'ok' }))[0].title,
    'Host memory normal'
  );
});

test('a level that holds sends nothing: the model holds it through the hysteresis band (#361)', () => {
  for (const level of ['ok', 'warn', 'crit']) {
    assert.deepEqual(sentFor(...levels({ cpu: level }, { cpu: level })), [], level);
  }
});

test('every reading the model judges pages, the storage pools and temperature included', () => {
  const events = diffSnapshots(
    ...levels(
      { cpu: 'ok', disk: 'ok', mem: 'ok', temp: 'ok', 'pool:local-lvm': 'ok' },
      { cpu: 'warn', disk: 'warn', mem: 'warn', temp: 'warn', 'pool:local-lvm': 'warn' }
    )
  );
  assert.deepEqual(
    events.map((e) => [e.id, e.title]),
    [
      ['n1:cpu', 'Host CPU high'],
      ['n1:disk', 'Host disk high'],
      ['n1:mem', 'Host memory high'],
      ['n1:pool:local-lvm', 'Host storage pool local-lvm high'],
      ['n1:temp', 'Host temperature high'],
    ]
  );
});

test('#448: a reading new to the snapshot pages if it appears at warn or crit, and is quiet at ok', () => {
  assert.deepEqual(
    sentFor(...levels({ cpu: 'ok' }, { cpu: 'ok', 'pool:tank': 'warn', temp: 'crit', disk: 'ok' })),
    ['host_threshold n1:pool:tank warning null->warn', 'host_threshold n1:temp critical null->crit']
  );
});

test('#468: a reading that leaves the snapshot over its line sends its clear; at ok, nothing', () => {
  assert.deepEqual(
    sentFor(
      ...levels({ disk: 'ok', 'pool:a': 'warn', 'pool:b': 'crit', 'pool:c': 'ok' }, { disk: 'ok' })
    ),
    [
      'host_threshold_cleared n1:pool:a info warn->null',
      'host_threshold_cleared n1:pool:b info crit->null',
    ]
  );
  assert.deepEqual(
    diffSnapshots(...levels({ 'pool:a': 'warn' }, {}))[0].title,
    'Host storage pool a normal'
  );
  // A host that leaves the snapshot (its node left services.yaml) sends nothing.
  assert.deepEqual(
    diffSnapshots(host({ n1: { reachable: true, levels: { 'pool:a': 'warn' } } }), host({})),
    []
  );
  // Nor does a host that goes unreachable: that is its own push.
  assert.deepEqual(
    sentFor(
      host({ n1: { reachable: true, levels: { 'pool:a': 'warn' } } }),
      host({ n1: { reachable: false, levels: {} } })
    ),
    ['host_unreachable n1 critical true->false']
  );
});

test('#469: a reading that leaves while held with no value (it has a start) sends nothing; one last read sends its clear', () => {
  const prev = host({
    n1: {
      reachable: true,
      levels: { disk: 'ok', 'pool:a': 'warn', temp: 'crit', mem: 'warn' },
      heldSince: { temp: 1_782_345_600_000 },
    },
  });
  const next = host({ n1: { reachable: true, levels: { disk: 'ok' } } });
  assert.deepEqual(
    diffSnapshots(prev, next).map((e) => `${e.type} ${e.id}`),
    ['host_threshold_cleared n1:mem', 'host_threshold_cleared n1:pool:a'],
    'temp, held with no value, leaves silently (its 24 h were up in the model)'
  );
  // Held with no value and then read normal: that is a reading, and its clear.
  assert.deepEqual(
    diffSnapshots(
      prev,
      host({ n1: { reachable: true, levels: { ...prev.hosts.n1.levels, temp: 'ok' } } })
    ).map((e) => `${e.type} ${e.id}`),
    ['host_threshold_cleared n1:temp']
  );
});

test('#448: a host first seen unreachable (no levels) that comes back over its line sends the reading too', () => {
  const prev = host({ n1: { reachable: false, levels: {} } });
  const next = host({ n1: { reachable: true, levels: { cpu: 'ok', disk: 'warn' } } });
  assert.deepEqual(
    diffSnapshots(prev, next).map((e) => `${e.type} ${e.id}`),
    ['host_recovered n1', 'host_threshold n1:disk']
  );
});

test('a snapshot written before #292 (readings, not levels) compares no level on the deploy cycle', () => {
  const old = host({ n1: { reachable: true, cpu: 0.95, mem: 0.1, disk: 0.1 } });
  assert.deepEqual(
    diffSnapshots(
      old,
      host({ n1: { reachable: true, levels: { cpu: 'ok', disk: 'warn', mem: 'ok' } } })
    ),
    []
  );
});

test('level changes are skipped when the host is not reachable in next', () => {
  const [prev] = levels({ cpu: 'ok' }, {});
  const next = host({ n1: { reachable: false, levels: { cpu: 'warn' } } });
  assert.deepEqual(
    diffSnapshots(prev, next).map((e) => e.type),
    ['host_unreachable']
  );
});

test('the cycle a host comes back, its held levels are compared too', () => {
  const prev = host({ n1: { reachable: false, levels: { disk: 'warn' } } });
  const next = host({ n1: { reachable: true, levels: { disk: 'ok' } } });
  assert.deepEqual(
    diffSnapshots(prev, next).map((e) => `${e.type} ${e.id}`),
    ['host_recovered n1', 'host_threshold_cleared n1:disk']
  );
});

// ── UPS ──────────────────────────────────────────────────────────────────

function ups(state) {
  return { ...EMPTY, ups: { state } };
}

test('ups online->on_battery emits ups_on_battery(critical)', () => {
  const events = diffSnapshots(ups('online'), ups('on_battery'));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'ups_on_battery',
    id: 'ups',
    node: 'ups',
    title: 'UPS on battery',
    body: 'UPS',
    severity: 'critical',
    reason: undefined,
    prev: 'online',
    next: 'on_battery',
  });
});

test('ups on_battery->online emits ups_restored(info)', () => {
  const events = diffSnapshots(ups('on_battery'), ups('online'));
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].type, events[0].title, events[0].severity],
    ['ups_restored', 'UPS restored', 'info']
  );
});

test('#448: ups unknown (no known state) -> on_battery emits ups_on_battery(critical)', () => {
  const events = diffSnapshots(ups('unknown'), ups('on_battery'));
  assert.deepEqual(
    events.map((e) => [e.type, e.severity, e.prev, e.next]),
    [['ups_on_battery', 'critical', 'unknown', 'on_battery']]
  );
  // A snapshot with no UPS entry at all is the same.
  assert.deepEqual(
    diffSnapshots({ ...EMPTY, ups: undefined }, ups('on_battery')).map((e) => e.type),
    ['ups_on_battery']
  );
});

test('ups to unknown, and unknown -> online (no known state), emit nothing', () => {
  assert.deepEqual(diffSnapshots(ups('online'), ups('unknown')), []);
  assert.deepEqual(diffSnapshots(ups('on_battery'), ups('unknown')), []);
  assert.deepEqual(diffSnapshots(ups('unknown'), ups('online')), []);
  assert.deepEqual(diffSnapshots(ups('unknown'), ups('unknown')), []);
});

test('ups unchanged emits nothing', () => {
  assert.deepEqual(diffSnapshots(ups('online'), ups('online')), []);
  assert.deepEqual(diffSnapshots(ups('on_battery'), ups('on_battery')), []);
});

// ── Cron ─────────────────────────────────────────────────────────────────

function cron(map) {
  return { ...EMPTY, cron: map };
}

test('cron success->failure emits cron_failed(warning)', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'failure' }));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    type: 'cron_failed',
    id: 'n1:backup',
    node: 'n1',
    title: 'Cron job failed',
    body: 'backup on n1',
    severity: 'warning',
    reason: undefined,
    prev: 'success',
    next: 'failure',
  });
});

test('cron new (no prev) ->failure emits cron_failed with prev=unknown', () => {
  const events = diffSnapshots(cron({}), cron({ 'n1:backup': 'failure' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cron_failed');
  assert.equal(events[0].prev, 'unknown');
});

test('cron failure->success emits cron_recovered(info)', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'success' }));
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].type, events[0].title, events[0].severity, events[0].prev, events[0].next],
    ['cron_recovered', 'Cron job recovered', 'info', 'failure', 'success']
  );
});

test('cron failure->unknown and unchanged emit nothing', () => {
  assert.deepEqual(
    diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'unknown' })),
    []
  );
  assert.deepEqual(
    diffSnapshots(cron({ 'n1:backup': 'success' }), cron({ 'n1:backup': 'success' })),
    []
  );
  assert.deepEqual(
    diffSnapshots(cron({ 'n1:backup': 'failure' }), cron({ 'n1:backup': 'failure' })),
    []
  );
});

for (const from of ['success', 'failure', 'unknown']) {
  test(`cron ${from}->overdue emits cron_overdue(warning)`, () => {
    const events = diffSnapshots(cron({ 'n1:backup': from }), cron({ 'n1:backup': 'overdue' }));
    assert.deepEqual(
      events.map((e) => [e.type, e.id, e.title, e.severity, e.prev, e.next]),
      [['cron_overdue', 'n1:backup', 'Cron job overdue', 'warning', from, 'overdue']]
    );
  });
}

test('cron overdue->success emits cron_recovered', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'overdue' }), cron({ 'n1:backup': 'success' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cron_recovered');
  assert.equal(events[0].prev, 'overdue');
});

test('cron overdue->failure emits cron_failed', () => {
  const events = diffSnapshots(cron({ 'n1:backup': 'overdue' }), cron({ 'n1:backup': 'failure' }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'cron_failed');
  assert.equal(events[0].prev, 'overdue');
});

test('cron overdue->overdue and overdue->unknown emit nothing', () => {
  assert.deepEqual(
    diffSnapshots(cron({ 'n1:backup': 'overdue' }), cron({ 'n1:backup': 'overdue' })),
    []
  );
  assert.deepEqual(
    diffSnapshots(cron({ 'n1:backup': 'overdue' }), cron({ 'n1:backup': 'unknown' })),
    []
  );
});

test('cron overdue->removed job emits nothing', () => {
  assert.deepEqual(diffSnapshots(cron({ 'n1:backup': 'overdue' }), cron({})), []);
});

test("a backup (a cron job marked as one, #291) pages as a cron job, with the model's reason", () => {
  const status = {
    entities: [
      {
        id: 'backups/nas:b2',
        kind: 'backup',
        name: 'b2',
        node: 'nas',
        state: 'crit',
        word: 'Failed',
        reason: 'Last backup failed',
      },
    ],
  };
  const [event] = diffSnapshots(
    cron({ 'nas:b2': 'success' }),
    cron({ 'nas:b2': 'failure' }),
    status
  );
  assert.deepEqual(
    [event.type, event.body, event.severity],
    ['cron_failed', 'b2 on nas · Last backup failed', 'critical']
  );
});

test('#478: only a failed backup pages as critical; a failed job, an overdue backup and a recovery keep their severity', () => {
  const entity = (id, kind, state) => ({
    id,
    kind,
    name: id.split(':')[1],
    node: 'nas',
    state,
    reason: 'r',
  });
  const failed = diffSnapshots(
    cron({ 'nas:b2': 'success', 'nas:sync': 'success' }),
    cron({ 'nas:b2': 'failure', 'nas:sync': 'failure' }),
    {
      entities: [
        entity('backups/nas:b2', 'backup', 'crit'),
        entity('jobs/nas:sync', 'job', 'warn'),
      ],
    }
  );
  assert.deepEqual(
    failed.map((e) => [e.id, e.type, e.severity]),
    [
      ['nas:b2', 'cron_failed', 'critical'],
      ['nas:sync', 'cron_failed', 'warning'],
    ]
  );
  const [overdue] = diffSnapshots(cron({ 'nas:b2': 'success' }), cron({ 'nas:b2': 'overdue' }), {
    entities: [entity('backups/nas:b2', 'backup', 'warn')],
  });
  assert.deepEqual([overdue.type, overdue.severity], ['cron_overdue', 'warning']);
  // Failed, then overdue: the model still says crit ("failed · overdue"), but
  // the critical page went out with the failure; the overdue one stays a warning.
  const [stillFailed] = diffSnapshots(
    cron({ 'nas:b2': 'failure' }),
    cron({ 'nas:b2': 'overdue' }),
    {
      entities: [entity('backups/nas:b2', 'backup', 'crit')],
    }
  );
  assert.deepEqual([stillFailed.type, stillFailed.severity], ['cron_overdue', 'warning']);
  const [recovered] = diffSnapshots(cron({ 'nas:b2': 'failure' }), cron({ 'nas:b2': 'success' }), {
    entities: [entity('backups/nas:b2', 'backup', 'ok')],
  });
  assert.deepEqual([recovered.type, recovered.severity], ['cron_recovered', 'info']);
});

// ── Monitoring sources: one push for a failed source (#292) ──────────────

function sources(map) {
  return { ...EMPTY, sources: map };
}

test('a source down (its second failed cycle) sends one source_down; its recovery one source_recovered', () => {
  assert.deepEqual(
    diffSnapshots(sources({ prometheus: 'ok' }), sources({ prometheus: 'failing' })),
    [],
    'one failed cycle: nothing'
  );
  assert.deepEqual(sentFor(sources({ prometheus: 'failing' }), sources({ prometheus: 'down' })), [
    'source_down prometheus warning failing->down',
  ]);
  assert.deepEqual(
    diffSnapshots(sources({ prometheus: 'down' }), sources({ prometheus: 'down' })),
    [],
    'while down: nothing'
  );
  assert.deepEqual(sentFor(sources({ prometheus: 'down' }), sources({ prometheus: 'ok' })), [
    'source_recovered prometheus info down->ok',
  ]);
  assert.deepEqual(
    diffSnapshots(sources({ prometheus: 'failing' }), sources({ prometheus: 'ok' })),
    [],
    'a blip: nothing'
  );
});

test('a source with no state before (a snapshot written before #292) pages once it is down', () => {
  assert.deepEqual(sentFor(sources({}), sources({ kuma: 'down' })), [
    'source_down kuma warning ok->down',
  ]);
  assert.deepEqual(diffSnapshots(sources({}), sources({ kuma: 'failing' })), []);
});

test('source words: the issue\'s reason going down; "answering again" coming back', () => {
  const [down] = diffSnapshots(
    sources({ prometheus: 'failing' }),
    sources({ prometheus: 'down' }),
    STATUS
  );
  assert.deepEqual(
    [down.title, down.body, down.node],
    ['Monitoring source down', 'Prometheus · HTTP 500', 'prometheus']
  );
  const [back] = diffSnapshots(sources({ nut: 'down' }), sources({ nut: 'ok' }));
  assert.deepEqual(
    [back.title, back.body],
    ['Monitoring source recovered', 'NUT is answering again']
  );
});

test('the status check (#440): one source_down at critical on its second failed cycle, one recovery; a blip sends nothing', () => {
  assert.deepEqual(diffSnapshots(sources({}), sources({ status: 'failing' })), [], 'one failed cycle');
  assert.deepEqual(sentFor(sources({ status: 'failing' }), sources({ status: 'down' })), [
    'source_down status critical failing->down',
  ]);
  assert.deepEqual(diffSnapshots(sources({ status: 'down' }), sources({ status: 'down' })), []);
  assert.deepEqual(sentFor(sources({ status: 'down' }), sources({ status: 'ok' })), [
    'source_recovered status info down->ok',
  ]);
  // It builds again after one failed cycle, or the cycle after its recovery: it leaves the snapshot quietly.
  assert.deepEqual(diffSnapshots(sources({ status: 'failing' }), sources({})), []);
  assert.deepEqual(diffSnapshots(sources({ status: 'ok' }), sources({})), []);
});

test('the status check\'s words are its own: nothing comes from a model', () => {
  const pair = [sources({ status: 'failing' }), sources({ status: 'down' })];
  const [down] = diffSnapshots(...pair);
  // A status that even names a source "status" changes nothing.
  const named = {
    entities: [{ id: 'sources/status', kind: 'source', name: 'Something', state: 'warn', reason: 'leaked' }],
  };
  assert.deepEqual(diffSnapshots(...pair, named), [down]);
  assert.deepEqual(diffSnapshots(...pair, STATUS), [down]);
  assert.deepEqual(
    [down.title, down.node, down.reason],
    ['JagHelm status check failing', 'status', undefined]
  );
  const [back] = diffSnapshots(sources({ status: 'down' }), sources({ status: 'ok' }), named);
  assert.equal(back.title, 'JagHelm status check recovered');
});

test("the config (#505): one source_down on its second broken cycle, with the model's reason; one recovery in its own words", () => {
  const issue = {
    id: 'sources/config',
    kind: 'source',
    subsystem: 'sources',
    name: 'JagHelm config',
    state: 'warn',
    word: 'Failed',
    reason: "services.yaml doesn't parse (line 4)",
  };
  const status = { entities: [], issues: [issue] };
  assert.deepEqual(diffSnapshots(sources({}), sources({ config: 'failing' }), status), []);
  const [down, ...more] = diffSnapshots(sources({ config: 'failing' }), sources({ config: 'down' }), status);
  assert.deepEqual(more, []);
  assert.deepEqual(
    [down.type, down.id, down.node, down.severity, down.title, down.body, down.reason],
    [
      'source_down',
      'config',
      'config',
      'warning',
      'JagHelm config broken',
      "JagHelm config · services.yaml doesn't parse (line 4)",
      "services.yaml doesn't parse (line 4)",
    ]
  );
  assert.deepEqual(diffSnapshots(sources({ config: 'down' }), sources({ config: 'down' }), status), []);
  const [back] = diffSnapshots(sources({ config: 'down' }), sources({ config: 'ok' }), { entities: [], issues: [] });
  assert.deepEqual(
    [back.type, back.severity, back.title, back.body, back.reason],
    // True for a fix by hand, a permission fix and a deletion (#536).
    ['source_recovered', 'info', 'JagHelm config fixed', 'services.yaml is no longer broken', undefined]
  );
  // A blip, or the cycle after its recovery: it leaves the snapshot quietly.
  assert.deepEqual(diffSnapshots(sources({ config: 'failing' }), sources({})), []);
  assert.deepEqual(diffSnapshots(sources({ config: 'ok' }), sources({})), []);
});

// ── Determinism ──────────────────────────────────────────────────────────

test('canonical sort: two insertion-order permutations produce byte-identical arrays', () => {
  // Same logical changes, keys inserted in different order in `next`.
  const prevA = {
    services: { 'n1:web': 'up', 'n2:db': 'up' },
    hosts: { n1: { reachable: true, levels: { cpu: 'ok', disk: 'ok' } } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
    sources: { kuma: 'failing', prometheus: 'ok' },
  };
  const nextA = {
    services: { 'n1:web': 'down', 'n2:db': 'down' },
    hosts: { n1: { reachable: true, levels: { cpu: 'warn', disk: 'crit' } } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
    sources: { kuma: 'down', prometheus: 'ok' },
  };
  // Permutation: same data, different object key insertion order.
  const prevB = {
    sources: { prometheus: 'ok', kuma: 'failing' },
    cron: { 'n1:backup': 'success' },
    ups: { state: 'online' },
    services: { 'n2:db': 'up', 'n1:web': 'up' },
    hosts: { n1: { levels: { disk: 'ok', cpu: 'ok' }, reachable: true } },
  };
  const nextB = {
    sources: { prometheus: 'ok', kuma: 'down' },
    cron: { 'n1:backup': 'failure' },
    ups: { state: 'on_battery' },
    services: { 'n2:db': 'down', 'n1:web': 'down' },
    hosts: { n1: { levels: { disk: 'crit', cpu: 'warn' }, reachable: true } },
  };
  const a = diffSnapshots(prevA, nextA, STATUS);
  const b = diffSnapshots(prevB, nextB, STATUS);
  assert.equal(JSON.stringify(a), JSON.stringify(b)); // byte-identical
});

test('canonical sort: ascending by (type, id) with id tiebreak', () => {
  const prev = {
    services: { 'n1:a': 'up', 'n2:z': 'up' },
    hosts: {},
    ups: { state: 'online' },
    cron: { 'n1:job': 'success' },
  };
  const next = {
    services: { 'n1:a': 'down', 'n2:z': 'down' },
    hosts: {},
    ups: { state: 'on_battery' },
    cron: { 'n1:job': 'failure' },
  };
  const events = diffSnapshots(prev, next);
  assert.deepEqual(
    events.map((e) => [e.type, e.id]),
    [
      ['cron_failed', 'n1:job'],
      ['service_down', 'n1:a'],
      ['service_down', 'n2:z'],
      ['ups_on_battery', 'ups'],
    ]
  );
  // explicit determinism guard: re-running yields byte-identical output
  assert.equal(JSON.stringify(diffSnapshots(prev, next)), JSON.stringify(events));
});

test('canonical sort: same type, id ordering uses string compare (n1:cpu < n1:disk < n1:mem)', () => {
  const events = diffSnapshots(
    ...levels({ mem: 'ok', cpu: 'ok', disk: 'ok' }, { mem: 'warn', disk: 'warn', cpu: 'warn' })
  );
  assert.deepEqual(
    events.map((e) => e.id),
    ['n1:cpu', 'n1:disk', 'n1:mem']
  );
});

test('purity: diffSnapshots does not mutate prev, next or the status', () => {
  const freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
    return Object.freeze(o);
  };
  const prev = freeze({
    services: { 'n1:web': 'up' },
    hosts: { n1: { reachable: true, levels: { cpu: 'ok' } } },
    ups: { state: 'online' },
    cron: { 'n1:backup': 'success' },
    sources: { prometheus: 'failing' },
  });
  const next = freeze({
    services: { 'n1:web': 'down' },
    hosts: { n1: { reachable: true, levels: { cpu: 'warn' } } },
    ups: { state: 'on_battery' },
    cron: { 'n1:backup': 'failure' },
    sources: { prometheus: 'down' },
  });
  // Frozen inputs => any write attempt throws in strict mode; this passing proves no mutation.
  assert.doesNotThrow(() => diffSnapshots(prev, next, freeze(structuredClone(STATUS))));
});

test('purity: repeated identical calls return deep-equal, byte-identical results (no module state)', () => {
  const prev = { services: { 'n1:web': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const next = { services: { 'n1:web': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const r1 = diffSnapshots(prev, next, STATUS);
  const r2 = diffSnapshots(prev, next, STATUS);
  const r3 = diffSnapshots(prev, next, STATUS);
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  assert.equal(JSON.stringify(r2), JSON.stringify(r3));
});

test('clock-free: result independent of wall time (no Date.now in output)', () => {
  const prev = { services: { 'n1:web': 'up' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const next = { services: { 'n1:web': 'down' }, hosts: {}, ups: { state: 'online' }, cron: {} };
  const before = diffSnapshots(prev, next, STATUS);
  const realNow = Date.now;
  Date.now = () => 1234567890; // tamper the clock
  try {
    const after = diffSnapshots(prev, next, STATUS);
    assert.equal(JSON.stringify(before), JSON.stringify(after)); // unaffected
  } finally {
    Date.now = realNow;
  }
});

test('cross-category: all 13 event types can co-occur in one cycle, sorted', () => {
  const prev = {
    services: { 'n1:web': 'up', 'n1:api': 'down' },
    hosts: {
      n1: { reachable: true, levels: { cpu: 'warn', mem: 'ok' } }, // cpu will clear, mem rise
      n2: { reachable: true, levels: {} },
      n3: { reachable: false, levels: {} }, // will recover
    },
    ups: { state: 'online' },
    cron: { 'n1:b1': 'success', 'n1:b2': 'failure', 'n1:b3': 'success' },
    sources: { kuma: 'failing', nut: 'down' },
  };
  const next = {
    services: { 'n1:web': 'down', 'n1:api': 'up' }, // down + recovered
    hosts: {
      n1: { reachable: true, levels: { cpu: 'ok', mem: 'warn' } },
      n2: { reachable: false, levels: {} }, // unreachable
      n3: { reachable: true, levels: {} }, // recovered
    },
    ups: { state: 'on_battery' }, // on_battery
    cron: { 'n1:b1': 'failure', 'n1:b2': 'success', 'n1:b3': 'overdue' }, // failed + recovered + overdue
    sources: { kuma: 'down', nut: 'ok' }, // down + recovered
  };
  const events = diffSnapshots(prev, next, STATUS);
  const types = [...new Set(events.map((e) => e.type))].sort();
  assert.deepEqual(types, [
    'cron_failed',
    'cron_overdue',
    'cron_recovered',
    'host_recovered',
    'host_threshold',
    'host_threshold_cleared',
    'host_unreachable',
    'service_down',
    'service_recovered',
    'source_down',
    'source_recovered',
    'ups_on_battery',
  ]);
  // (ups_restored is the 13th; it can't co-occur with ups_on_battery.)
  // fully sorted by (type,id), and re-run is byte-identical
  const sorted = [...events].sort((a, b) =>
    a.type < b.type ? -1 : a.type > b.type ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  assert.deepEqual(events, sorted);
  assert.equal(JSON.stringify(events), JSON.stringify(diffSnapshots(prev, next, STATUS)));
});

test('arcane recoveries honour notifyRecoveries', () => {
  assert.ok(RECOVERY_TYPES.has('arcane_cleared'));
  assert.ok(RECOVERY_TYPES.has('arcane_agent_recovered'));
  assert.ok(!RECOVERY_TYPES.has('arcane_agent_offline'));
});

// ── alertStateKey ────────────────────────────────────────────────────────

test('alertStateKey: a level, reachability, status or source change gives a new key', () => {
  const base = {
    ...host({ n1: { reachable: true, levels: { cpu: 'ok', mem: 'ok' } } }),
    sources: { prometheus: 'ok' },
  };
  const key = alertStateKey(base);
  assert.equal(alertStateKey(structuredClone(base)), key, 'the same state, the same key');
  assert.notEqual(
    alertStateKey(host({ n1: { reachable: true, levels: { cpu: 'warn', mem: 'ok' } } })),
    key
  );
  assert.notEqual(
    alertStateKey({ ...base, hosts: { n1: { ...base.hosts.n1, reachable: false } } }),
    key
  );
  assert.notEqual(alertStateKey({ ...base, services: { 'n1:svc': 'down' } }), key);
  assert.notEqual(alertStateKey({ ...base, ups: { state: 'on_battery' } }), key);
  assert.notEqual(alertStateKey({ ...base, cron: { 'n1:backup': 'failure' } }), key);
  assert.notEqual(alertStateKey({ ...base, sources: { prometheus: 'failing' } }), key);
  // The status check's run (#440): the file must keep it for a restart.
  assert.notEqual(alertStateKey({ ...base, sources: { prometheus: 'ok', status: 'failing' } }), key);
  // When a hold began: the differ reads it (#469), and the file must keep it.
  assert.notEqual(
    alertStateKey({ ...base, hosts: { n1: { ...base.hosts.n1, heldSince: { mem: 1 } } } }),
    key
  );
});

test('alertStateKey: a change of the monitor that fed a service key gives a new key (#395)', () => {
  const a = { ...svc({ 'n1:x': 'down', 'n1:y': 'up' }), monitorOf: { 'n1:x': '1', 'n1:y': '2' } };
  const b = { ...a, monitorOf: { 'n1:x': '2', 'n1:y': '1' } };
  assert.notEqual(alertStateKey(a), alertStateKey(b));
  assert.notEqual(alertStateKey(a), alertStateKey({ ...a, monitorOf: undefined }));
});

// ── #395: a service key is diffed against the state of the monitor that feeds it ──

// A services snapshot with the monitor of each key: { key: [status, monitorId?] }.
function fed(map) {
  const services = {};
  const monitorOf = {};
  for (const [key, [status, monitor]] of Object.entries(map)) {
    services[key] = status;
    if (monitor !== undefined) monitorOf[key] = monitor;
  }
  return { ...svc(services), monitorOf };
}
const sent = (prev, next) =>
  diffSnapshots(prev, next).map((e) => `${e.type} ${e.id} ${e.prev}->${e.next}`);

test('#395: a monitor whose key moves brings its state with it', () => {
  // Down under its own name, then a container takes it, still down: nothing.
  assert.deepEqual(
    sent(fed({ 'n1:Grafana': ['down', '7'] }), fed({ 'n1:grafana': ['down', '7'] })),
    []
  );
  // Down on its stopped container's card, up on the container that took it: the recovery.
  assert.deepEqual(
    sent(
      fed({ 'n1:nextcloud': ['down', '3'] }),
      fed({ 'n1:nextcloud-app': ['up', '3'], 'n1:nextcloud': ['unknown'] })
    ),
    ['service_recovered n1:nextcloud-app down->up']
  );
  // Up on one card, down on another: one service_down.
  assert.deepEqual(sent(fed({ 'n1:a': ['up', '1'] }), fed({ 'n2:a': ['down', '1'] })), [
    'service_down n2:a up->down',
  ]);
});

test('#395: a key whose monitor moved on starts fresh', () => {
  // Its monitor moved to another card, still down, and a container with no monitor has the key: no false recovery.
  assert.deepEqual(
    sent(fed({ 'n1:x': ['down', '1'] }), fed({ 'n1:x': ['up'], 'n1:y': ['down', '1'] })),
    []
  );
  // Another monitor, new to the snapshot, has it now: no false recovery, and its own outage pages once.
  assert.deepEqual(
    sent(fed({ 'n1:x': ['down', '2'] }), fed({ 'n1:x': ['up', '1'], 'n1:y': ['down', '2'] })),
    []
  );
  assert.deepEqual(
    sent(fed({ 'n1:x': ['up', '2'] }), fed({ 'n1:x': ['down', '1'], 'n1:y': ['up', '2'] })),
    ['service_down n1:x unknown->down']
  );
});

test('#395: a key whose monitor has gone and that no monitor feeds now starts fresh', () => {
  // Paused or deleted while down, on a running container whose own status is up: no false recovery.
  const paused = fed({ 'n1:x': ['up'] });
  assert.deepEqual(sent(fed({ 'n1:x': ['down', '1'] }), paused), []);
  // Unpaused while still down: a new outage, as for a monitor with no container (#390).
  assert.deepEqual(sent(paused, fed({ 'n1:x': ['down', '1'] })), ['service_down n1:x up->down']);
  // Unpaused up, or deleted for good: nothing more.
  assert.deepEqual(sent(paused, fed({ 'n1:x': ['up', '1'] })), []);
  assert.deepEqual(sent(paused, fed({ 'n1:x': ['up'] })), []);
});

test('#395: a key that a monitor new to the snapshot feeds keeps its own state, as before', () => {
  // Deleted from Kuma and added again (a new id) for the same service, still down: no repeat.
  assert.deepEqual(sent(fed({ 'n1:x': ['down', '1'] }), fed({ 'n1:x': ['down', '9'] })), []);
  assert.deepEqual(sent(fed({ 'n1:x': ['down', '1'] }), fed({ 'n1:x': ['up', '9'] })), [
    'service_recovered n1:x down->up',
  ]);
});

test('#407: a monitor an explicit mapping gives several cards is one event, whichever cards it has', () => {
  // A second mapped container appears while the monitor is down: still the one outage.
  assert.deepEqual(
    sent(fed({ 'n1:x': ['down', '1'] }), fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] })),
    []
  );
  // Both go down together: one service_down, on the first card; both come back: one recovery.
  assert.deepEqual(
    sent(
      fed({ 'n1:x': ['up', '1'], 'n2:x': ['up', '1'] }),
      fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] })
    ),
    ['service_down n1:x up->down']
  );
  assert.deepEqual(
    sent(
      fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] }),
      fed({ 'n1:x': ['up', '1'], 'n2:x': ['up', '1'] })
    ),
    ['service_recovered n1:x down->up']
  );
  // A card leaves during the outage: the recovery comes on the card it has left.
  assert.deepEqual(
    sent(fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] }), fed({ 'n2:x': ['up', '1'] })),
    ['service_recovered n2:x down->up']
  );
  // It fed several cards and now feeds one other: still the same outage.
  assert.deepEqual(
    sent(fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] }), fed({ 'n3:x': ['down', '1'] })),
    []
  );
});

test('#407: the one event names every node the monitor is on', () => {
  const status = {
    entities: [{ id: 'services/n1:x', kind: 'service', name: 'Tailscale', reason: 'Kuma: down' }],
  };
  const [event] = diffSnapshots(
    fed({ 'n1:x': ['up', '1'], 'n2:x': ['up', '1'] }),
    fed({ 'n1:x': ['down', '1'], 'n2:x': ['down', '1'] }),
    status
  );
  assert.equal(event.body, 'Tailscale on n1, n2 · Kuma: down');
});

test('#395: a snapshot that records no monitors (written before #395) is diffed key by key', () => {
  const old = svc({ 'n1:Grafana': 'down', 'n1:x': 'up' });
  assert.deepEqual(
    sent(old, fed({ 'n1:Grafana': ['down', '7'], 'n1:x': ['up', '1'] })),
    [],
    'a deploy sends nothing'
  );
  assert.deepEqual(sent(old, fed({ 'n1:grafana': ['down', '7'], 'n1:x': ['up', '1'] })), [
    'service_down n1:grafana unknown->down',
  ]);
  assert.deepEqual(sent({ ...old, monitorOf: 'junk' }, fed({ 'n1:Grafana': ['up', '7'] })), [
    'service_recovered n1:Grafana down->up',
  ]);
});

test('#395: two monitors that swap keys each keep their own state', () => {
  const prev = fed({ 'n1:a': ['down', '1'], 'n1:b': ['up', '2'] });
  assert.deepEqual(sent(prev, fed({ 'n1:a': ['up', '2'], 'n1:b': ['down', '1'] })), []);
  assert.deepEqual(sent(prev, fed({ 'n1:a': ['up', '2'], 'n1:b': ['up', '1'] })), [
    'service_recovered n1:b down->up',
  ]);
});
