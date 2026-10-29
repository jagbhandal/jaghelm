/**
 * Drive health in the status model (status/drives.js, drive-health design §3,
 * §5, §6): every row of the judging table, the per-drive conditions and their
 * roll-up to the node, the blind source, the optional-module paths and the
 * failure isolation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cycles, entityOf, inputs, node, once } from '../testing/statusFixtures.js';
import { buildStatus } from './model.js';
import { driveKey, judgeDrive, readFailed } from './drives.js';
import { DEFAULT_THRESHOLDS } from './thresholds.js';

const T = DEFAULT_THRESHOLDS;
const zero = { count: 0, grew: false };

/** A healthy SATA drive; `over` replaces fields. */
function hdd(device = 'sda', over = {}) {
  return {
    device,
    model: 'ST8000VN004',
    type: 'hdd',
    smartPassed: true,
    criticalWarning: null,
    availableSpare: null,
    spareThreshold: null,
    percentageUsed: null,
    temperature: 40,
    powerOnSeconds: 19_872_000,
    exitStatus: 0,
    mediaErrors: null,
    sectors: { reallocated: zero, pending: zero, uncorrectable: zero },
    ...over,
  };
}

/** A healthy NVMe. */
function nvme(device = 'nvme0', over = {}) {
  return {
    device,
    model: 'CT1000P310SSD8',
    type: 'nvme',
    smartPassed: true,
    criticalWarning: 0,
    availableSpare: 100,
    spareThreshold: 5,
    percentageUsed: 2,
    temperature: 30,
    powerOnSeconds: 19_674_000,
    exitStatus: 0,
    mediaErrors: zero,
    sectors: null,
    ...over,
  };
}

const sectors = (over) => ({ reallocated: zero, pending: zero, uncorrectable: zero, ...over });
const read = (...drivesByNode) => ({
  enabled: true,
  nodes: Object.fromEntries(
    drivesByNode.map(([key, drives, extra = {}]) => [
      key,
      { devices: drives.length, scrapeUp: true, drives, ...extra },
    ])
  ),
});

/** The model's status for a node `n1` over the drive inputs of consecutive cycles. */
function over(...reads) {
  return cycles(reads.map((drives) => inputs({ nodes: { n1: node() }, drives })));
}

// ── Every row of §5 ──────────────────────────────────────────────────────

test('judging a drive: each row of the table', () => {
  const rows = [
    // [drive, level, the phrase it gives]
    [hdd(), 'ok', null],
    [hdd('sdb', { smartPassed: false }), 'crit', 'failed its health check'],
    [nvme('nvme0', { criticalWarning: 1 }), 'crit', 'reports a critical warning'],
    [nvme('nvme0', { criticalWarning: 0 }), 'ok', null],
    [nvme('nvme0', { mediaErrors: { count: 9, grew: true } }), 'crit', 'media errors that grew in the last 7 days'],
    [nvme('nvme0', { mediaErrors: { count: 9, grew: false } }), 'ok', null],
    [
      hdd('sda', { sectors: sectors({ reallocated: { count: 3, grew: true } }) }),
      'warn',
      'has 3 reallocated sectors (grew in the last 7 days)',
    ],
    [
      hdd('sda', { sectors: sectors({ pending: { count: 1, grew: true } }) }),
      'warn',
      'has 1 pending sector (grew in the last 7 days)',
    ],
    [
      hdd('sda', { sectors: sectors({ uncorrectable: { count: 2, grew: true } }) }),
      'warn',
      'has 2 offline-uncorrectable sectors (grew in the last 7 days)',
    ],
    // A stable pile of remapped sectors is not an incident.
    [hdd('sda', { sectors: sectors({ reallocated: { count: 40, grew: false } }) }), 'ok', null],
    [nvme('nvme0', { availableSpare: 5, spareThreshold: 5 }), 'warn', 'has 5 % spare left (warning at 5 %)'],
    [nvme('nvme0', { availableSpare: 4, spareThreshold: 5 }), 'warn', 'has 4 % spare left (warning at 5 %)'],
    [nvme('nvme0', { availableSpare: 6, spareThreshold: 5 }), 'ok', null],
    [nvme('nvme0', { availableSpare: 3, spareThreshold: null }), 'ok', null],
    // Temperature, by kind: NVMe 70/80, SATA 55/60.
    [nvme('nvme0', { temperature: 69.9 }), 'ok', null],
    [nvme('nvme0', { temperature: 70 }), 'warn', 'is at 70 °C (warning above 70 °C)'],
    [nvme('nvme0', { temperature: 80 }), 'crit', 'is at 80 °C (critical above 80 °C)'],
    [hdd('sda', { temperature: 54 }), 'ok', null],
    [hdd('sda', { temperature: 55 }), 'warn', 'is at 55 °C (warning above 55 °C)'],
    [hdd('sda', { temperature: 60 }), 'crit', 'is at 60 °C (critical above 60 °C)'],
    [hdd('sda', { type: 'ssd', temperature: 62 }), 'crit', 'is at 62 °C (critical above 60 °C)'],
    [nvme('nvme0', { temperature: 62 }), 'ok', null], // SATA's line is not the NVMe's
    [hdd('sda', { temperature: null }), 'ok', null],
  ];
  for (const [drive, level, phrase] of rows) {
    const j = judgeDrive(drive, { thresholds: T });
    assert.equal(j.level, level, JSON.stringify(drive));
    if (phrase === null) assert.deepEqual(j.phrases, [], JSON.stringify(drive));
    else assert.ok(j.phrases.some((p) => p.text.includes(phrase)), `${JSON.stringify(drive)} -> ${JSON.stringify(j.phrases)}`);
  }
});

test('the worst condition wins, and the reason lists them worst first', () => {
  const j = judgeDrive(
    hdd('sdb', {
      smartPassed: false,
      temperature: 56,
      sectors: sectors({ reallocated: { count: 2, grew: true } }),
    }),
    { thresholds: T }
  );
  assert.equal(j.level, 'crit');
  assert.deepEqual(
    j.phrases.map((p) => p.state),
    ['crit', 'warn', 'warn']
  );
  assert.equal(j.phrases[0].text, 'failed its health check');
});

test('temperature hysteresis: a level holds until the reading falls 5 °C below its line', () => {
  const walk = (readings, make, start) => {
    let prev = start;
    const out = [];
    for (const temperature of readings) {
      const j = judgeDrive(make(temperature), { prevLevel: prev, prevTemp: prev, thresholds: T });
      prev = j.tempLevel;
      out.push(j.level);
    }
    return out;
  };
  // NVMe: warn at 70, held until below 65; crit at 80, held until below 75, then warn.
  assert.deepEqual(walk([70, 66, 65, 64.9, 70, 80, 76, 75, 74.9, 69, 64], (t) => nvme('nvme0', { temperature: t })), [
    'warn', 'warn', 'warn', 'ok', 'warn', 'crit', 'crit', 'crit', 'warn', 'warn', 'ok',
  ]);
  // SATA: warn at 55, held until below 50.
  assert.deepEqual(walk([55, 51, 50, 49.9], (t) => hdd('sda', { temperature: t })), ['warn', 'warn', 'warn', 'ok']);
  // The held reason says so.
  const held = judgeDrive(hdd('sda', { temperature: 52 }), { prevTemp: 'warn', thresholds: T });
  assert.match(held.phrases[0].text, /is at 52 °C \(warning until below 50 °C\)/);
});

test('the lines are the thresholds’: a saved NVMe line moves the verdict', () => {
  const lines = { ...T, driveTemp: { ...T.driveTemp, nvme: { warn: 60, crit: 75 } } };
  assert.equal(judgeDrive(nvme('nvme0', { temperature: 61 }), { thresholds: lines }).level, 'warn');
  assert.equal(judgeDrive(nvme('nvme0', { temperature: 61 }), { thresholds: T }).level, 'ok');
});

test('growth windows: counter reset and no history are not growth; a drive still remapping is', () => {
  // The source marks `grew` from a positive delta only (drives.test.js); here, what the judge does with it.
  const stable = hdd('sda', { sectors: sectors({ reallocated: { count: 12, grew: false } }) });
  assert.equal(judgeDrive(stable, { thresholds: T }).level, 'ok');
  const reset = hdd('sda', { sectors: sectors({ reallocated: { count: 0, grew: false } }) }); // replaced drive, same name
  assert.equal(judgeDrive(reset, { thresholds: T }).level, 'ok');
  const growing = hdd('sda', { sectors: sectors({ reallocated: { count: 12, grew: true } }) });
  assert.equal(judgeDrive(growing, { thresholds: T }).level, 'warn');
});

test('standby: the exporter serves a sleeping drive’s last values, and the same values judge the same', () => {
  const failed = hdd('sdb', { smartPassed: false });
  const a = judgeDrive(failed, { thresholds: T });
  const b = judgeDrive(structuredClone(failed), { prevLevel: a.level, thresholds: T });
  assert.deepEqual(b, a);
  assert.equal(b.level, 'crit');
});

test('readFailed: only smartctl’s command-failure bits are a failed read, not findings about the drive', () => {
  assert.equal(readFailed({ exitStatus: 0 }), false);
  assert.equal(readFailed({ exitStatus: 1 }), true); // command line did not parse
  assert.equal(readFailed({ exitStatus: 2 }), true); // device would not open
  assert.equal(readFailed({ exitStatus: 4 }), true); // a SMART command failed
  assert.equal(readFailed({ exitStatus: 8 }), false); // the drive says it is failing: judged by smart_status
  assert.equal(readFailed({ exitStatus: 64 }), false); // the error log has entries
  assert.equal(readFailed({ exitStatus: 66 }), true);
  assert.equal(readFailed({ exitStatus: null }), false);
});

// ── The model: a condition per drive, rolled up to the node ──────────────

test('each drive is its own condition on its node, keyed drive:<node>:<device>', () => {
  const [s] = over(read(['n1', [hdd('sda'), hdd('sdb', { smartPassed: false })]]));
  const n = entityOf(s, 'nodes/n1');
  assert.equal(driveKey('n1', 'sda'), 'drive:n1:sda');
  assert.equal(n.conditions['drive:n1:sda'], 'ok');
  assert.equal(n.conditions['drive:n1:sdb'], 'crit');
  assert.equal(n.state, 'crit');
  assert.equal(n.word, 'Critical');
  assert.match(n.reason, /drive sdb failed its health check/);
  assert.deepEqual(
    n.drives.map((d) => [d.key, d.device, d.state, d.word, d.reason]),
    [
      ['drive:n1:sda', 'sda', 'ok', 'Healthy', 'Healthy'],
      ['drive:n1:sdb', 'sdb', 'crit', 'Critical', 'drive sdb failed its health check'],
    ]
  );
});

test('the node’s state is the worst of its readings and its drives', () => {
  const [calm, hot] = [
    once(inputs({ nodes: { n1: node({ cpu: '10' }) }, drives: read(['n1', [hdd('sda', { temperature: 56 })]]) })),
    once(inputs({ nodes: { n1: node({ diskPercent: '97.0' }) }, drives: read(['n1', [hdd('sda', { temperature: 56 })]]) })),
  ];
  assert.equal(entityOf(calm, 'nodes/n1').state, 'warn'); // the drive alone
  const both = entityOf(hot, 'nodes/n1');
  assert.equal(both.state, 'crit'); // the disk, worse than the drive's warning
  assert.match(both.reason, /^Disk 97 %.* · drive sda is at 56 °C/);
  // A healthy drive changes nothing about a node that is ok.
  const ok = once(inputs({ nodes: { n1: node() }, drives: read(['n1', [hdd('sda')]]) }));
  assert.equal(entityOf(ok, 'nodes/n1').state, 'ok');
  assert.equal(entityOf(ok, 'nodes/n1').reason, 'Healthy');
});

test('a node that does not read a drive has no drives, and the Pi with no SMART shows none', () => {
  const s = once(inputs({ nodes: { n1: node(), pi: node() }, drives: read(['n1', [hdd('sda')]]) }));
  assert.ok(entityOf(s, 'nodes/n1').drives);
  assert.equal('drives' in entityOf(s, 'nodes/pi'), false);
  assert.deepEqual(Object.keys(entityOf(s, 'nodes/pi').conditions).sort(), ['cpu', 'disk', 'mem', 'temp']);
});

test('a drive’s level holds with the temperature’s hysteresis across cycles', () => {
  const at = (t) => read(['n1', [hdd('sda', { temperature: t })]]);
  const levels = over(at(54), at(55), at(52), at(50), at(49)).map(
    (s) => entityOf(s, 'nodes/n1').conditions['drive:n1:sda']
  );
  assert.deepEqual(levels, ['ok', 'warn', 'warn', 'warn', 'ok']);
});

test('a drive that leaves the read leaves the node, and its condition with it', () => {
  const [a, b] = over(read(['n1', [hdd('sda'), hdd('sdb')]]), read(['n1', [hdd('sda')]]));
  assert.ok('drive:n1:sdb' in entityOf(a, 'nodes/n1').conditions);
  assert.equal('drive:n1:sdb' in entityOf(b, 'nodes/n1').conditions, false);
});

// ── Off and absent: the model is what it was ────────────────────────────

test('the module off or absent leaves the model byte-identical to a build with no drives input', () => {
  const base = inputs({
    nodes: { n1: node(), n2: node({ cpu: '50' }) },
    cron: [],
  });
  const build = (extra) => {
    const first = buildStatus({ inputs: { ...base, ...extra }, thresholds: T, now: 1_782_345_600_000 });
    const second = buildStatus({
      inputs: { ...base, ...extra },
      thresholds: T,
      memory: first.memory,
      now: 1_782_345_630_000,
    });
    return JSON.stringify([first, second]);
  };
  const without = build({});
  assert.equal(build({ drives: null }), without, 'no read');
  assert.equal(build({ drives: { enabled: false } }), without, 'JAGHELM_DRIVES=off');
  assert.equal(build({ drives: { enabled: true, nodes: {} } }), without, 'the probe found no series');
  assert.equal(
    build({ drives: { enabled: true, nodes: { ghost: { devices: 1, scrapeUp: true, drives: [hdd()] } } } }),
    without,
    'drives only on a node the board does not have'
  );
  // With drives on a node, the model does differ, which is what the test above is for.
  assert.notEqual(build({ drives: read(['n1', [hdd()]]) }), without);
});

test('turning the module off drops what the model held, as any reading no longer listed', () => {
  const [on, off] = cycles([
    inputs({ nodes: { n1: node() }, drives: read(['n1', [hdd('sda', { smartPassed: false })]]) }),
    inputs({ nodes: { n1: node() }, drives: { enabled: false } }),
  ]);
  assert.equal(entityOf(on, 'nodes/n1').state, 'crit');
  assert.equal(entityOf(off, 'nodes/n1').state, 'ok');
  assert.equal('drive:n1:sda' in entityOf(off, 'nodes/n1').conditions, false);
  assert.deepEqual(Object.keys(off.sources).filter((n) => n.startsWith('drives-source:')), []);
});

// ── A read that did not run keeps what the model holds ──────────────────

test('a failed read (no drive input) keeps a drive’s level and invents nothing', () => {
  const [bad, missed, back] = over(
    read(['n1', [hdd('sda', { smartPassed: false }), hdd('sdb')]]),
    null,
    read(['n1', [hdd('sda'), hdd('sdb')]])
  );
  assert.equal(entityOf(bad, 'nodes/n1').conditions['drive:n1:sda'], 'crit');
  const held = entityOf(missed, 'nodes/n1');
  assert.equal(held.state, 'crit');
  assert.equal(held.conditions['drive:n1:sda'], 'unknown');
  assert.equal(held.conditions['drive:n1:sdb'], 'unknown');
  assert.match(held.reason, /drive sda: no reading \(critical held\)/);
  assert.equal(entityOf(back, 'nodes/n1').conditions['drive:n1:sda'], 'ok');
  assert.ok(!('drives' in held), 'no drive list from a read that did not run');
});

// ── Blind: a source of its own, never the node's state ──────────────────

test('a node that had drives and now has none is blind: one source, unknown, the node not amber', () => {
  const [seen, blind] = over(read(['n1', [hdd('sda'), hdd('sdb')]]), { enabled: true, nodes: {} });
  assert.deepEqual(Object.keys(seen.sources).filter((n) => n.startsWith('drives-source:')), []);
  const n = entityOf(blind, 'nodes/n1');
  assert.equal(n.state, 'ok', 'the node keeps its other readings');
  assert.equal(n.reason, 'Healthy');
  assert.equal(n.conditions['drive:n1:sda'], 'unknown', 'held, not judged');
  assert.equal(blind.sources['drives-source:n1'].state, 'failed');
  const issue = blind.issues.find((i) => i.id === 'sources/drives-source:n1');
  assert.deepEqual(
    [issue.kind, issue.state, issue.word, issue.reason],
    ['source', 'unknown', 'No signal', 'Drive monitoring has no signal on Node']
  );
  assert.equal(blind.overall.state, 'unknown');
});

test('blind by the scrape down, or a failed smartctl read; not by findings about the drive', () => {
  const had = read(['n1', [hdd('sda')]]);
  const after = (extra, drives) =>
    cycles([inputs({ nodes: { n1: node() }, drives: had }), inputs({ nodes: { n1: node() }, drives: read(['n1', drives, extra]) })])[1];
  const blindOf = (s) => 'drives-source:n1' in s.sources;
  assert.equal(blindOf(after({ scrapeUp: false }, [hdd('sda')])), true, 'scrape up is 0');
  assert.equal(blindOf(after({}, [hdd('sda', { exitStatus: 2 })])), true, 'the device would not open');
  assert.equal(blindOf(after({}, [hdd('sda', { exitStatus: 64 })])), false, 'an error log with entries is the drive’s');
  assert.equal(blindOf(after({}, [hdd('sda', { exitStatus: 8, smartPassed: false })])), false);
  // Series gone but the exporter says 0 devices: the drives are gone, not the signal.
  assert.equal(blindOf(after({ devices: 0 }, [])), false, 'zero devices');
  assert.equal(blindOf(after({ devices: null }, [])), true, 'series gone, exporter silent');
});

test('a node that never had drive data raises nothing, whether the module is off, empty or unread', () => {
  for (const drives of [null, { enabled: false }, { enabled: true, nodes: {} }]) {
    const s = once(inputs({ nodes: { n1: node() }, drives }));
    assert.deepEqual(Object.keys(s.sources).filter((n) => n.startsWith('drives-source:')), []);
    assert.equal(s.overall.state, 'ok');
  }
});

test('a blind node holds a failed drive’s level; the node stays at it and the source says why', () => {
  const [, blind] = over(read(['n1', [hdd('sda', { smartPassed: false })]]), { enabled: true, nodes: {} });
  const n = entityOf(blind, 'nodes/n1');
  assert.equal(n.state, 'crit');
  assert.equal(n.conditions['drive:n1:sda'], 'unknown');
  assert.ok('drives-source:n1' in blind.sources);
});

test('blind ends when the drives are read again', () => {
  const [, , back] = over(read(['n1', [hdd('sda')]]), { enabled: true, nodes: {} }, read(['n1', [hdd('sda')]]));
  assert.equal('drives-source:n1' in back.sources, false);
  assert.equal(entityOf(back, 'nodes/n1').conditions['drive:n1:sda'], 'ok');
});

// ── Failure isolation ────────────────────────────────────────────────────

test('a throw in judging a node’s drives is reported and never stops the build', () => {
  const poisoned = hdd('sda');
  Object.defineProperty(poisoned, 'temperature', {
    enumerable: true,
    get() {
      throw new Error('no temperature');
    },
  });
  const seen = [];
  const run = (drives, memory) =>
    buildStatus({
      inputs: inputs({ nodes: { n1: node(), n2: node() }, drives }),
      thresholds: T,
      memory,
      now: 1_782_345_600_000,
      onDriveFault: (err) => seen.push(err),
    });
  const first = run(read(['n1', [hdd('sda', { smartPassed: false })]], ['n2', [hdd('sdb')]]), null);
  const second = run(read(['n1', [poisoned]], ['n2', [hdd('sdb')]]), first.memory);
  assert.equal(seen[0], null, 'the first build judged drives');
  assert.equal(seen[1].message, 'no temperature');
  // The throwing node is judged without its drives and keeps what it held; the rest of the model is whole.
  const n1 = entityOf(second.status, 'nodes/n1');
  assert.equal(n1.conditions['drive:n1:sda'], 'unknown');
  assert.equal(n1.state, 'crit');
  assert.ok(entityOf(second.status, 'nodes/n2').drives, 'the other node’s drives are judged');
  assert.equal(entityOf(second.status, 'nodes/n2').conditions.cpu, 'ok');
  // And it builds again once the fault is gone.
  const third = run(read(['n1', [hdd('sda')]], ['n2', [hdd('sdb')]]), second.memory);
  assert.equal(seen[2], null);
  assert.equal(entityOf(third.status, 'nodes/n1').conditions['drive:n1:sda'], 'ok');
});

test('no onDriveFault is no problem', () => {
  assert.doesNotThrow(() => once(inputs({ nodes: { n1: node() }, drives: read(['n1', [hdd()]]) })));
});
