/**
 * A push says what the screens say (#292): each event's reason is the status
 * model's reason for the entity it is about, word for word, and its body is
 * the entity's name (and node) and that reason. One row per entity kind push
 * sends for, each run through the real model and the real push cycle
 * (testing/pushPipeline.js); then the kinds push sends nothing for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMessage } from './fcm.js';
import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import {
  NOW,
  UPS_ONLINE,
  cronNode,
  cronRun,
  missing,
  monitored,
  node,
} from '../testing/statusFixtures.js';

const OK = { prometheus: { ok: true }, kuma: { ok: true } };

/** One cycle's caches: node n1 (`metrics`, `extra`), its cards, the UPS, the cron jobs, the integrations. */
function board({
  metrics = {},
  extra = {},
  cards = [],
  ups = UPS_ONLINE,
  cron = [],
  integrations = {},
  sources = OK,
} = {}) {
  return cachesOf({
    services: {
      sources,
      nodes: { n1: node(metrics, { display_name: 'Node One', services: cards, ...extra }) },
    },
    ups,
    cron,
    integrations,
  });
}
const pool = (percent) => ({
  proxmox: {
    _preset: 'proxmox',
    _target: 'n1:pve',
    _storagePools: [{ name: 'local-lvm', percent }],
    _status: { state: 'ok' },
  },
});
const jobs = (run) => [cronNode('n1', { restic: run })];
const UPS_ON_BATTERY = { ...UPS_ONLINE, status: 2, charge: 80 };
const PROMETHEUS_FAILED = { prometheus: { ok: false }, kuma: { ok: true } };

// [what happens, its cycles, the event type, the model id whose reason it carries, the subject]
const ROWS = [
  [
    'a service goes down',
    [
      board({ cards: [monitored('n1:app', 'up')] }),
      board({ cards: [monitored('n1:app', 'down')] }),
    ],
    'service_down',
    'services/n1:app',
    'app on n1',
  ],
  [
    'a service recovers',
    [
      board({ cards: [monitored('n1:app', 'down')] }),
      board({ cards: [monitored('n1:app', 'up')] }),
    ],
    'service_recovered',
    'services/n1:app',
    'app on n1',
  ],
  [
    'a node becomes unreachable',
    [board(), board({ extra: { reachable: false } })],
    'host_unreachable',
    'nodes/n1',
    'Node One',
  ],
  [
    'a node comes back',
    [board(), board({ extra: { reachable: false } }), board()],
    'host_recovered',
    'nodes/n1',
    'Node One',
  ],
  [
    'a disk crosses its warn line',
    [board(), board({ metrics: { diskPercent: '92.4' } })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'a disk crosses its crit line',
    [board(), board({ metrics: { diskPercent: '96' } })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'memory crosses its line',
    [board(), board({ metrics: { memPercent: '91' } })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'CPU holds over its line for 2 cycles',
    [board(), board({ metrics: { cpu: '97' } }), board({ metrics: { cpu: '97' } })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'the hottest sensor crosses its line',
    [board(), board({ metrics: { temp: '80' } })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'a storage pool crosses its line',
    [board({ integrations: pool(50) }), board({ integrations: pool(93) })],
    'host_threshold',
    'nodes/n1',
    'Node One',
  ],
  [
    'a reading is back below the clear level',
    [board({ metrics: { diskPercent: '92' } }), board({ metrics: { diskPercent: '80' } })],
    'host_threshold_cleared',
    'nodes/n1',
    'Node One',
  ],
  [
    'the UPS goes on battery',
    [board(), board({ ups: UPS_ON_BATTERY })],
    'ups_on_battery',
    'power/ups',
    'Back-UPS',
  ],
  [
    'the UPS is back on mains',
    [board({ ups: UPS_ON_BATTERY }), board()],
    'ups_restored',
    'power/ups',
    'Back-UPS',
  ],
  [
    'a job fails',
    [
      board({ cron: jobs(cronRun('success')) }),
      board({ cron: jobs(cronRun('failure', 30_000, { error: 'exit 3' })) }),
    ],
    'cron_failed',
    'jobs/n1:restic',
    'restic on n1',
  ],
  [
    'a job recovers',
    [board({ cron: jobs(cronRun('failure')) }), board({ cron: jobs(cronRun('success', 30_000)) })],
    'cron_recovered',
    'jobs/n1:restic',
    'restic on n1',
  ],
  [
    'a job is overdue',
    [
      board({ cron: jobs(cronRun('success', 0, { expected_every_seconds: 60 })) }),
      board({ cron: jobs(cronRun('success', 0, { expected_every_seconds: 60 })) }),
    ],
    'cron_overdue',
    'jobs/n1:restic',
    'restic on n1',
    { advanceMs: 3_600_000 }, // an hour passes with no report
  ],
  [
    'a backup fails',
    [board({ cron: jobs(cronRun('success')) }), board({ cron: jobs(cronRun('failure', 30_000)) })],
    'cron_failed',
    'backups/n1:restic',
    'restic on n1',
    { backupJobs: ['n1:restic'] },
  ],
  [
    'a monitoring source is down',
    [
      board(),
      board({ sources: PROMETHEUS_FAILED, extra: { failedReads: ['cpu'] } }),
      board({ sources: PROMETHEUS_FAILED, extra: { failedReads: ['cpu'] } }),
    ],
    'source_down',
    'sources/prometheus',
    'Prometheus',
  ],
];

for (const [what, cycles, type, id, subject, opts = {}] of ROWS) {
  test(`words: ${what}: ${type} carries the model's reason for ${id}`, async () => {
    const p = pushPipeline({ start: NOW });
    try {
      let status;
      for (const [i, c] of cycles.entries()) {
        if (i === cycles.length - 1 && opts.advanceMs) p.advance(opts.advanceMs);
        status = await p.cycle(c, { backupJobs: opts.backupJobs ?? [] });
      }
      const events = p.events.filter((e) => e.type === type);
      assert.equal(events.length, 1, `one ${type}: ${p.sent.join(', ')}`);
      const entity = [...status.entities, ...status.issues].find((e) => e.id === id);
      assert.ok(entity?.reason, `the model has a reason for ${id}`);
      assert.equal(events[0].reason, entity.reason);
      assert.equal(events[0].body, `${subject} · ${entity.reason}`);
    } finally {
      p.close();
    }
  });
}

// The kinds push has never paged for, and still doesn't: the screens show them,
// the phone doesn't ring. (A container whose monitor is down pages as its
// service; an Arcane agent pages through the Arcane poller, #291.)
test('words: a missing container, a failing integration send nothing', async () => {
  const p = pushPipeline();
  try {
    await p.cycle(
      board({
        cards: [monitored('n1:app', 'up')],
        integrations: { sonarr: { _preset: 'sonarr', _status: { state: 'ok' } } },
      })
    );
    const status = await p.cycle(
      board({
        cards: [monitored('n1:app', 'up'), missing('n1:redis')],
        integrations: {
          sonarr: { _preset: 'sonarr', _error: 'HTTP 500', _status: { state: 'backing_off' } },
        },
      })
    );
    assert.deepEqual(
      status.issues.map((e) => [e.id, e.state]),
      [
        ['services/n1:redis', 'warn'],
        ['integrations/sonarr', 'warn'],
      ],
      'the screens show both'
    );
    assert.deepEqual(p.sent, []);
  } finally {
    p.close();
  }
});

// An Arcane agent is a model entity (#291), but its pushes stay the Arcane
// poller's own (arcane_agent_offline after 2 polls down, arcane_agent_recovered):
// the status push sends nothing for it, so an outage is one push, not two.
test('words: an Arcane agent going offline and back sends nothing from the status push', async () => {
  const p = pushPipeline();
  try {
    const agents = (state) => [
      { env: 'vm-101', state },
      { env: 'vm-103', state: 'up' },
    ];
    await p.cycle(board(), { arcaneAgents: agents('up') });
    const down = await p.cycle(board(), { arcaneAgents: agents('down') });
    assert.deepEqual(
      down.issues.map((e) => [e.id, e.state]),
      [['integrations/arcane:vm-101', 'warn']],
      'the screens show it'
    );
    await p.cycle(board(), { arcaneAgents: agents('down') });
    const back = await p.cycle(board(), { arcaneAgents: agents('up') });
    assert.deepEqual(back.issues, []);
    assert.deepEqual(p.sent, []);
  } finally {
    p.close();
  }
});

// A job marked as a backup (#291) pages as the job did: the phone gets the same
// type, id, node and severity (the Android keys), so an installed app routes
// and shows it as before. Only the reason words are the backup's.
test('words: a job marked as a backup pages with the same Android keys as before it was marked', async () => {
  const data = async (backupJobs, cycles, advanceMs = 0) => {
    const p = pushPipeline({ start: NOW });
    try {
      for (const [i, c] of cycles.entries()) {
        if (i === cycles.length - 1) p.advance(advanceMs);
        await p.cycle(c, { backupJobs });
      }
      return p.events.map((e) => ({ data: buildMessage('phone', e).data, body: e.body }));
    } finally {
      p.close();
    }
  };
  const failing = [
    board({ cron: jobs(cronRun('success')) }),
    board({ cron: jobs(cronRun('failure', 30_000, { error: 'exit 3' })) }),
  ];
  const late = [
    board({ cron: jobs(cronRun('success', 0, { expected_every_seconds: 60 })) }),
    board({ cron: jobs(cronRun('success', 0, { expected_every_seconds: 60 })) }),
  ];
  for (const [what, cycles, advanceMs, type, asJob, asBackup] of [
    ['failed', failing, 0, 'cron_failed', 'Last run failed: exit 3', 'Last backup failed: exit 3'],
    ['overdue', late, 3_600_000, 'cron_overdue', /Overdue/, /Overdue/],
  ]) {
    const job = await data([], cycles, advanceMs);
    const backup = await data(['n1:restic'], cycles, advanceMs);
    assert.equal(job.length, 1, what);
    assert.deepEqual(backup.map((e) => e.data), job.map((e) => e.data), `${what}: same data`);
    assert.deepEqual(backup[0].data, { type, id: 'n1:restic', node: 'n1', severity: 'warning' });
    assert.match(job[0].body, typeof asJob === 'string' ? new RegExp(`· ${asJob}$`) : asJob);
    assert.match(backup[0].body, typeof asBackup === 'string' ? new RegExp(`· ${asBackup}$`) : asBackup);
  }
});
