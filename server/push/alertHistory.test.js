/**
 * #267: the alert history, the store behind GET /api/events. Each differ event
 * becomes a record with an id, a time, its entity, severity and words, and
 * what push did with it; the store is bounded by age (30 days) and count, and
 * pages newest first by id, so a page holds still while new events arrive.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAlertHistory,
  HISTORY_CAP,
  HISTORY_MAX_AGE_MS,
  pushOutcome,
} from './alertHistory.js';

const T0 = 1_782_345_600_000;
const DAY = 24 * 60 * 60 * 1000;

/** A differ event, as push/differ.js makes it. */
const down = (key, extra = {}) => ({
  type: 'service_down',
  id: key,
  node: key.split(':')[0],
  title: 'Service down',
  body: `${key} · Kuma: down`,
  severity: 'critical',
  reason: 'Kuma: down',
  prev: 'up',
  next: 'down',
  ...extra,
});
const up = (key) => ({
  ...down(key),
  type: 'service_recovered',
  title: 'Service recovered',
  body: `${key} · Kuma: up`,
  severity: 'info',
  reason: 'Kuma: up',
});

function recording() {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, logger: { debug() {}, info: at('info'), warn: at('warn'), error: at('error') } };
}

function history(opts = {}) {
  const clock = { now: T0 };
  const h = createAlertHistory({ now: () => clock.now, ...opts });
  return { h, clock };
}

const ids = (page) => page.events.map((e) => e.id);

test('#267: a record has an id, the time, the entity the model knows it by, the severity, the words and what push did', () => {
  const { h } = history();
  const [id] = h.record([down('vm103:immich')], 'off');
  assert.equal(id, '1');
  assert.deepEqual(h.page().events, [
    {
      id: '1',
      at: new Date(T0).toISOString(),
      type: 'service_down',
      severity: 'critical',
      entity: 'services/vm103:immich',
      title: 'Service down',
      body: 'vm103:immich · Kuma: down',
      reason: 'Kuma: down',
      node: 'vm103',
      key: 'vm103:immich',
      push: { state: 'off', phones: 0, suppressed: 0 },
    },
  ]);
});

test('#267: each family keeps the entity a tap opens (#309): a reading is its node, a backup the model id the differ found, the status check none', () => {
  const { h } = history();
  h.record(
    [
      { type: 'host_threshold', id: 'pve:disk', node: 'pve', title: 'Host disk high', body: 'pve · Disk 94 %', severity: 'warning', reason: 'Disk 94 %' },
      { type: 'cron_failed', id: 'nas:restic', node: 'nas', title: 'Cron job failed', body: 'restic on nas', severity: 'critical', reason: 'exit 3', entity: 'backups/nas:restic' },
      { type: 'ups_on_battery', id: 'ups', node: 'ups', title: 'UPS on battery', body: 'UPS', severity: 'critical' },
      { type: 'source_down', id: 'status', node: 'status', title: 'JagHelm status check failing', body: '…', severity: 'critical', reason: undefined },
    ],
    'queued'
  );
  assert.deepEqual(
    h.page().events.map((e) => [e.type, e.entity, e.reason]),
    [
      ['source_down', null, null],
      ['ups_on_battery', 'power/ups', null],
      ['cron_failed', 'backups/nas:restic', 'exit 3'],
      ['host_threshold', 'nodes/pve', 'Disk 94 %'],
    ]
  );
});

test('#267: newest first, by id; a page is never longer than asked; `next` is the cursor for the older ones', () => {
  const { h, clock } = history();
  for (let i = 0; i < 5; i += 1) {
    h.record([down(`n1:s${i}`)], 'off');
    clock.now += 1_000;
  }
  const first = h.page({ limit: 2 });
  assert.deepEqual(ids(first), ['5', '4']);
  assert.equal(first.next, '4');
  const second = h.page({ limit: 2, before: Number(first.next) });
  assert.deepEqual(ids(second), ['3', '2']);
  const last = h.page({ limit: 2, before: Number(second.next) });
  assert.deepEqual(ids(last), ['1']);
  assert.equal(last.next, null, 'nothing older');
  assert.equal(h.page({ limit: 5 }).next, null, 'a page that holds the rest has no cursor');
});

test('#267: the pages hold still while new events arrive: no event twice, none skipped', () => {
  const { h } = history();
  h.record([down('n1:a'), down('n1:b'), down('n1:c'), down('n1:d')], 'off');
  const first = h.page({ limit: 2 });
  assert.deepEqual(ids(first), ['4', '3']);
  h.record([up('n1:a'), up('n1:b')], 'off'); // arrive between the pages
  const second = h.page({ limit: 2, before: Number(first.next) });
  assert.deepEqual(ids(second), ['2', '1']);
  assert.deepEqual(ids(h.page({ limit: 2 })), ['6', '5'], 'the new ones are on top');
});

test('#267: filters by entity (one or several) and by severity, and pages within the filter', () => {
  const { h } = history();
  h.record([down('n1:a'), down('n1:b')], 'off');
  h.record([up('n1:a')], 'off');
  h.record([down('n1:a')], 'off');
  h.record([{ ...down('n1:c'), severity: 'warning' }], 'off');
  const a = h.page({ entities: new Set(['services/n1:a']), limit: 2 });
  assert.deepEqual(ids(a), ['4', '3']);
  assert.deepEqual(ids(h.page({ entities: new Set(['services/n1:a']), before: Number(a.next) })), ['1']);
  assert.deepEqual(ids(h.page({ entities: new Set(['services/n1:b', 'services/n1:c']) })), ['5', '2']);
  assert.deepEqual(ids(h.page({ severities: new Set(['info']) })), ['3']);
  assert.deepEqual(ids(h.page({ severities: new Set(['critical', 'warning']) })), ['5', '4', '2', '1']);
  assert.deepEqual(
    ids(h.page({ severities: new Set(['critical']), entities: new Set(['services/n1:a']) })),
    ['4', '1']
  );
  assert.deepEqual(h.page({ entities: new Set(['nodes/none']) }), { events: [], next: null });
});

test("#314: filters by the entity's kind (its id's first part) and by text, and pages within them", () => {
  const { h } = history();
  h.record([down('n1:a', { body: 'Jellyfin on n1 · Kuma: down' })], 'off');
  h.record(
    [
      {
        type: 'host_threshold',
        id: 'pve:disk',
        node: 'pve',
        title: 'Host disk high',
        body: 'Proxmox · Disk 91 %',
        severity: 'warning',
        reason: 'Disk 91 %',
      },
    ],
    'off'
  );
  h.record([{ ...up('n1:a'), body: 'Jellyfin on n1 · Kuma: up' }], 'off');
  // The status check's own event is no entity's: no kind has it.
  h.record([{ type: 'source_down', id: 'status', node: 'status', title: 'JagHelm status check failing', body: 'words', severity: 'critical' }], 'off');

  assert.deepEqual(ids(h.page({ kinds: new Set(['services']) })), ['3', '1']);
  assert.deepEqual(ids(h.page({ kinds: new Set(['nodes', 'services']) })), ['3', '2', '1']);
  assert.deepEqual(ids(h.page({ kinds: new Set(['power']) })), []);
  // Text: any case, in the title, the words, the reason or the entity's id.
  assert.deepEqual(ids(h.page({ text: 'JELLY' })), ['3', '1'], 'the words');
  assert.deepEqual(ids(h.page({ text: 'disk high' })), ['2'], 'the title');
  assert.deepEqual(ids(h.page({ text: 'nodes/pve' })), ['2'], "the entity's id");
  assert.deepEqual(ids(h.page({ text: 'status check' })), ['4'], 'an event of no entity');
  assert.deepEqual(ids(h.page({ text: 'kuma: up' })), ['3'], 'the reason');
  assert.deepEqual(ids(h.page({ text: 'nothing like it' })), []);
  // Together, with severity, and paged.
  const one = h.page({ kinds: new Set(['services']), text: 'jellyfin', limit: 1 });
  assert.deepEqual([ids(one), one.next], [['3'], '3']);
  assert.deepEqual(ids(h.page({ kinds: new Set(['services']), text: 'jellyfin', before: 3 })), ['1']);
  assert.deepEqual(ids(h.page({ kinds: new Set(['services']), severities: new Set(['info']) })), ['3']);
});

test('#267: what is served is a copy: a caller changing it changes nothing kept', () => {
  const { h } = history();
  h.record([down('n1:a')], 'off');
  h.page().events[0].push.state = 'sent';
  assert.equal(h.page().events[0].push.state, 'off');
});

test('#267: bounded to 30 days: an older event is never served and leaves the file', () => {
  const { h, clock } = history();
  h.record([down('n1:old')], 'off');
  clock.now += 10 * DAY;
  h.record([down('n1:new')], 'off');
  clock.now = T0 + HISTORY_MAX_AGE_MS; // the first is exactly 30 days old: kept
  assert.deepEqual(ids(h.page()), ['2', '1']);
  clock.now += 1;
  assert.deepEqual(ids(h.page()), ['2']);
  assert.deepEqual(h.toFile().events.map((e) => e.id), ['2']);
  assert.equal(HISTORY_MAX_AGE_MS, 30 * DAY);
});

test('#267: bounded by count: past the cap the oldest go first; ids are never given twice', () => {
  const { h } = history({ cap: 3 });
  h.record([down('n1:a'), down('n1:b')], 'off');
  h.record([down('n1:c'), down('n1:d')], 'off');
  assert.deepEqual(ids(h.page()), ['4', '3', '2']);
  assert.equal(h.toFile().lastId, 4);
  assert.equal(HISTORY_CAP, 1000);
});

test('#267: ids carry on from the file, also when every event in it has aged out', () => {
  const { h, clock } = history();
  h.record([down('n1:a'), down('n1:b')], 'off');
  clock.now += 31 * DAY;
  const filed = h.toFile();
  assert.deepEqual(filed, { lastId: 2, events: [] });

  const { h: restarted } = history();
  restarted.load(JSON.parse(JSON.stringify(filed)));
  assert.deepEqual(restarted.record([down('n1:c')], 'off'), ['3']);
});

test('#267: nothing recorded yet: nothing for the file', () => {
  const { h } = history();
  assert.equal(h.toFile(), null);
  h.load(undefined);
  assert.equal(h.toFile(), null);
});

test('#267: the file round-trips: a restart serves what was recorded, with what push did', () => {
  const { h, clock } = history();
  h.record([down('n1:a')], 'queued');
  clock.now += 30_000;
  const [id] = h.record([up('n1:a')], 'queued');
  h.settle(id, { state: 'sent', phones: 2, suppressed: 1 });
  const before = h.page();

  const { h: restarted } = history();
  restarted.load(JSON.parse(JSON.stringify(h.toFile())));
  assert.deepEqual(restarted.page(), before);
});

test('#267: an unreadable history starts empty with one warn that quotes nothing; a bad record is dropped, the rest kept', () => {
  for (const bad of [[], 'x', { events: 'no' }, { lastId: 3 }, null]) {
    const { lines, logger } = recording();
    const { h } = history({ logger });
    h.load(bad);
    assert.deepEqual(h.page(), { events: [], next: null });
    assert.deepEqual(lines.map((l) => [l.level, l.msg]), [['warn', 'alert history unreadable: starting with none']]);
  }

  const { h: good } = history();
  good.record([down('n1:a'), down('n1:b'), down('n1:c')], 'off');
  const file = JSON.parse(JSON.stringify(good.toFile()));
  file.events[1].severity = 'Hunter2-secret'; // pragma: allowlist secret
  file.events.push({ id: 'x', title: 'Hunter2-secret' }); // pragma: allowlist secret
  file.events.push(file.events[0]); // the same id twice
  const { lines, logger } = recording();
  const { h } = history({ logger });
  h.load(file);
  assert.deepEqual(ids(h.page()), ['3', '1']);
  assert.deepEqual(lines.map((l) => [l.level, l.msg, l.fields]), [
    ['warn', 'alert history: dropped events it cannot read', { dropped: 3, kept: 2 }],
  ]);
  assert.doesNotMatch(JSON.stringify(lines), /Hunter2/);
});

test('#267: what push did: sent once a phone got it, else suppressed, unsent or dropped; sent is never undone', () => {
  assert.deepEqual(pushOutcome({ sent: 2, suppressed: 1 }, 'done'), { state: 'sent', phones: 2, suppressed: 1 });
  assert.deepEqual(pushOutcome({ sent: 0, suppressed: 2 }, 'done'), { state: 'suppressed', phones: 0, suppressed: 2 });
  assert.deepEqual(pushOutcome({ sent: 0, suppressed: 0 }, 'done'), { state: 'unsent', phones: 0, suppressed: 0 });
  assert.deepEqual(pushOutcome(undefined, 'done'), { state: 'unsent', phones: 0, suppressed: 0 });
  assert.deepEqual(pushOutcome({ sent: 0, suppressed: 1 }, 'pending'), { state: 'queued', phones: 0, suppressed: 1 });
  assert.deepEqual(pushOutcome({ sent: 1, suppressed: 0 }, 'pending'), { state: 'sent', phones: 1, suppressed: 0 });
  assert.deepEqual(pushOutcome(undefined, 'dropped'), { state: 'dropped', phones: 0, suppressed: 0 });
  assert.deepEqual(pushOutcome({ sent: 1, suppressed: 0 }, 'dropped'), { state: 'sent', phones: 1, suppressed: 0 });

  const { h } = history();
  const [id] = h.record([down('n1:a')], 'queued');
  h.settle(id, { state: 'sent', phones: 2, suppressed: 0 });
  h.settle(id, { state: 'dropped', phones: 0, suppressed: 0 });
  h.settle(id, { state: 'sent', phones: 1, suppressed: 1 });
  assert.deepEqual(h.page().events[0].push, { state: 'sent', phones: 2, suppressed: 1 });
  assert.equal(h.settle('99', { state: 'sent', phones: 1, suppressed: 0 }), false, 'a record gone: nothing to do');
});
