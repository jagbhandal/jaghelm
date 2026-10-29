/**
 * The cross-client status suite, push side (#293, spec §6 "Proof", §12): the
 * same input can never give one answer on the screen and another in a push.
 *
 * Each fixture (testing/statusScenarios.js: healthy, incident, source-down,
 * first-run, thresholds, every-state, low-battery, config-broken) is built as the live loop
 * builds /api/status. Its status then goes through the real push cycle
 * (snapshot, differ, dispatch, the Web Push payload the phone receives), from two
 * starting points: an empty snapshot (the first-run board's: every issue is
 * new) and the healthy board's. Every push is checked against the model's entity it is about,
 * found through the event's type, id and node: the state its
 * severity says, the word its type stands for, and the reason. Every issue the
 * model pages for must have its push. The screen side, the same fixtures
 * through the src/ui components, is src/ui/crossClient.test.jsx (vitest, `npm
 * run test:client`); this file runs in `npm run test:ci`.
 *
 * A disagreement fails the suite unless a named exception in KNOWN covers it,
 * at the places it names. An exception that no longer happens fails too, so
 * deleting it is the whole change once it is settled.
 *
 * A push opens the entity it is about: it names it (its tag and URL carry the
 * model's id, #309), and that id's route is the entity's detail screen, which finds it in
 * the status (src/phone/nav/entityRoute.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entityFor, entityOfRoute, entityRoute } from '../../src/phone/nav/entityRoute.js';
import { runPushCycle } from '../push/dispatch.js';
import { createPushSender } from '../push/outbox.js';
import { alertStateKey } from '../push/differ.js';
import { entityOf } from '../push/entity.js';
import { buildWebPayload, deliveryOptions } from '../push/webPush.js';
import { buildSnapshot } from '../push/snapshot.js';
import { demoStatus } from '../demoFixtures.js';
import { onePhone } from '../testing/pushPipeline.js';
import {
  CYCLE_MS,
  STATUS_SCENARIOS,
  runScenario,
  scenarioStatus,
} from '../testing/statusScenarios.js';

const NOW = Date.parse('2026-10-19T12:00:00Z');

// ── The agreement rules ──────────────────────────────────────────────────

// A push's severity says a state: the one mapping push and screen share.
const STATE_OF_SEVERITY = { critical: 'crit', warning: 'warn', info: 'ok' };

// The model word each push stands for: its title says it ("Service down",
// "Cron job overdue"), and the screen shows the entity's word. The host
// pushes are about a reading's level (the entity's `conditions`) or about
// reachability, and source_recovered about the source's state.
const PUSH_WORDS = {
  service_down: ['Down'],
  service_recovered: ['Up'],
  host_unreachable: ['Unreachable'],
  ups_on_battery: ['On battery', 'Low battery'],
  ups_restored: ['On mains'],
  cron_failed: ['Failed'],
  cron_overdue: ['Overdue'],
  cron_recovered: ['OK'],
  source_down: ['Failed'],
};

/**
 * The push each model issue pages with (spec §6.1; PR #436, "What pages"),
 * or null when its kind never pages: a missing container and a failing
 * integration show on the screens only, an Arcane agent pages through the
 * Arcane poller (#291), a pending service holds its last state (#258) and
 * nothing unknown pages (a failed source is one push of its own).
 */
function pageFor(issue) {
  if (issue.state !== 'crit' && issue.state !== 'warn') return null;
  switch (issue.kind) {
    case 'service':
      return issue.state === 'crit' ? ['service_down'] : null;
    case 'ups':
      return ['ups_on_battery'];
    case 'job':
    case 'backup':
      return issue.word === 'Overdue' ? ['cron_overdue'] : ['cron_failed'];
    case 'source':
      return ['source_down'];
    default:
      return null;
  }
}

/**
 * The model's entity (or source issue) a push is about, from the event the
 * phone gets, and the id the dashboard routes it to: the entity's own, a backup's
 * too (the push names it as the model files it, #309).
 */
function subjectOf(data, status) {
  const { type, id, node } = data;
  const family = type.slice(0, type.indexOf('_'));
  switch (family) {
    case 'service':
      return { id: `services/${id}`, route: `services/${id}` };
    case 'host':
      return {
        id: `nodes/${node}`,
        reading: type.startsWith('host_threshold') ? id.slice(node.length + 1) : null,
        route: `nodes/${node}`,
      };
    case 'ups':
      return { id: 'power/ups', route: 'power/ups' };
    case 'cron': {
      const backup = status.entities.some((e) => e.id === `backups/${id}`);
      const entity = `${backup ? 'backups' : 'jobs'}/${id}`;
      return { id: entity, route: entity };
    }
    case 'source':
      return { id: `sources/${id}`, source: id, route: `sources/${id}` };
    default:
      return { id: `?${type}`, route: null };
  }
}

/**
 * Where a push and the model disagree, as findings `{ subject, reading, type,
 * what, model, push }`: each push against its entity, then each issue the
 * model pages for against the pushes.
 */
function disagreements(status, events) {
  const byId = new Map([...status.entities, ...status.issues].map((e) => [e.id, e]));
  const findings = [];
  const pushed = new Set();
  const key = (type, id, reading) => [type, id, reading].filter(Boolean).join(' ');
  for (const event of events) {
    const subject = subjectOf(event, status);
    pushed.add(key(event.type, subject.id, subject.reading));
    const entity = byId.get(subject.id);
    const say = (what, model, push) =>
      findings.push({
        subject: subject.id,
        reading: subject.reading,
        type: event.type,
        what,
        model,
        push,
      });
    if (event.type === 'source_recovered') {
      const state = status.sources[subject.source]?.state;
      if (state !== 'ok') say('severity', state ?? 'not listed', event.severity);
      continue;
    }
    if (!entity) {
      say('subject', 'nothing by that id', subject.id);
      continue;
    }
    const modelState = subject.reading ? entity.conditions?.[subject.reading] : entity.state;
    if (STATE_OF_SEVERITY[event.severity] !== modelState)
      say('severity', modelState, event.severity);
    const words = PUSH_WORDS[event.type];
    if (words && !words.includes(entity.word)) say('word', entity.word, words.join(' or '));
    if (event.reason !== entity.reason) say('reason', entity.reason, event.reason);
    if (!event.body.endsWith(` · ${entity.reason}`))
      say('body', entity.reason, event.body);
  }
  const missing = (issue, reading, type) =>
    findings.push({
      subject: issue.id,
      reading,
      type,
      what: 'missing',
      model: reading ? issue.conditions[reading] : issue.state,
      push: 'nothing',
    });
  for (const issue of status.issues) {
    if (issue.kind === 'node') {
      // An unreachable node pages once; a reachable one per reading over its line.
      if (issue.word === 'Unreachable') {
        if (!pushed.has(key('host_unreachable', issue.id)))
          missing(issue, null, 'host_unreachable');
        continue;
      }
      for (const [reading, level] of Object.entries(issue.conditions ?? {})) {
        if (level !== 'warn' && level !== 'crit') continue;
        if (!pushed.has(key('host_threshold', issue.id, reading)))
          missing(issue, reading, 'host_threshold');
      }
      continue;
    }
    const types = pageFor(issue);
    if (types && !types.some((t) => pushed.has(key(t, issue.id))))
      missing(issue, null, types.join(' or '));
  }
  return findings;
}

/** One finding as a line of a failure message. */
function describe(f) {
  const at = f.reading ? `${f.subject} ${f.reading}` : f.subject;
  switch (f.what) {
    case 'missing':
      return `${at}: the model says ${f.model}, and no ${f.type} was sent`;
    case 'severity':
      return `${at}: ${f.type} is sent as ${f.push}, the model says ${f.model}`;
    case 'word':
      return `${at}: ${f.type} stands for ${f.push}, the model's word is ${f.model}`;
    case 'subject':
      return `${f.type} is about ${f.push}, and the model has nothing by that id`;
    default:
      return `${at}: ${f.type}'s ${f.what} is "${f.push}", the model's is "${f.model}"`;
  }
}

// ── Known divergences ────────────────────────────────────────────────────

/**
 * The disagreements the suite knows about, each named, with the issue that
 * settles it and where it shows (fixture, starting snapshot). Each one covers
 * only its own findings, only where it says, and must still happen there.
 */
const KNOWN = [];

// ── The push side of a fixture ───────────────────────────────────────────

const errors = [];
const logger = {
  debug() {},
  info() {},
  warn() {},
  error: (fields, msg) => errors.push(`${msg}: ${fields?.err?.stack ?? ''}`),
};

/**
 * The push snapshot a run starts from: `empty`, the first-run board's
 * baseline (nothing in it), or `healthy`, the healthy board's.
 */
function startingSnapshot(from) {
  const { status, cycle } = runScenario(from === 'empty' ? 'first-run' : 'healthy', {
    now: NOW - 10 * CYCLE_MS,
  });
  return buildSnapshot(cycle.caches, null, status);
}

/**
 * What a phone gets when the board, after `prev`, is the fixture's and stays
 * so: the real push cycle (runPushCycle: snapshot, differ, dispatch to a phone
 * that takes everything) on the fixture's status and caches, cycle after
 * cycle until the snapshot stops changing (a failed source pages on its
 * second failed cycle).
 */
async function pushesOnto(prev, { status, cycle }) {
  let current = prev;
  const queue = [];
  const memory = {
    prev: () => current,
    // Push is on throughout, so the history's baseline is push's (#267).
    historyPrev: () => current,
    commit: ({ push }) => push && memory.advance(push.snap, push.events),
    advance: (snap, events = []) => {
      current = snap;
      queue.push(...events.map((event) => ({ event, queuedAt: 0, sent: false, done: new Set() })));
    },
    outbox: () => queue.map((e) => e.event),
    entries: () => [...queue],
    head: () => queue[0] ?? null,
    has: (entry) => queue.includes(entry),
    complete: (entry) => queue.splice(queue.indexOf(entry), 1),
    save() {},
    flush() {},
  };
  const events = [];
  const channels = {
    isPushEnabled: () => true,
    sendToToken: async (_token, event) => {
      events.push(event);
      return { ok: true, prune: false };
    },
  };
  const store = onePhone();
  const sender = createPushSender({ outbox: memory, store, channels, logger });
  errors.length = 0;
  for (let i = 0; i < 5; i += 1) {
    const before = alertStateKey(current);
    await runPushCycle({
      buildSnapshotFn: (p) => buildSnapshot(cycle.caches, p, status),
      status,
      store,
      channels,
      snapshot: memory,
      sender,
      logger,
    });
    await sender.idle();
    assert.deepEqual(errors, [], 'the push cycle threw');
    if (alertStateKey(current) === before) return events;
  }
  throw new Error('the push snapshot never settled');
}

const FROM = ['empty', 'healthy'];

for (const name of STATUS_SCENARIOS) {
  for (const from of FROM) {
    test(`cross-client, push: ${name}, from the ${from} snapshot: each push says what the model says`, async () => {
      const run = runScenario(name, { now: NOW });
      const prev = startingSnapshot(from);
      const events = await pushesOnto(prev, run);
      const findings = disagreements(run.status, events);
      const here = KNOWN.filter((k) => k.at.some(([n, f]) => n === name && f === from));
      const unexplained = findings.filter((f) => !here.some((k) => k.covers(f, { prev })));
      assert.deepEqual(unexplained.map(describe), [], 'disagreements no named exception covers');
      for (const k of here) {
        assert.ok(
          findings.some((f) => k.covers(f, { prev })),
          `known divergence "${k.name}" (${k.issue}) no longer happens in ${name} from ${from}: delete it from KNOWN`
        );
      }
    });
  }
}

// ── What the phone gets, and the Web Push payload ────────────────────────────

// Each fixture's pushes from each start: the anchor that says what the
// fixture is about for push (source-down's single push, first-run's none).
// From the empty snapshot every entity is new, and is diffed from no previous
// state (#448): what is in trouble pages, what is ok doesn't.
const SENT = {
  healthy: { empty: [], healthy: [] },
  incident: {
    empty: ['cron_failed storage:nightly-backup', 'service_down apps:jellyfin'],
    healthy: ['cron_failed storage:nightly-backup', 'service_down apps:jellyfin'],
  },
  'source-down': { empty: ['source_down prometheus'], healthy: ['source_down prometheus'] },
  'first-run': { empty: [], healthy: [] },
  'every-state': {
    empty: [
      'cron_failed apps:db-dump',
      'cron_overdue apps:image-prune',
      'cron_overdue storage:nightly-backup',
      'host_unreachable edge',
      'ups_on_battery ups',
    ],
    healthy: [
      'cron_failed apps:db-dump',
      'cron_overdue apps:image-prune',
      'cron_overdue storage:nightly-backup',
      'host_unreachable edge',
      'ups_on_battery ups',
    ],
  },
  'low-battery': { empty: ['ups_on_battery ups'], healthy: ['ups_on_battery ups'] },
  'config-broken': { empty: ['source_down config'], healthy: ['source_down config'] },
  thresholds: {
    empty: [
      'host_threshold apps:cpu',
      'host_threshold apps:disk',
      'host_threshold edge:mem',
      'host_threshold storage:disk',
      'host_threshold storage:temp',
    ],
    healthy: [
      'host_threshold apps:cpu',
      'host_threshold apps:disk',
      'host_threshold edge:mem',
      'host_threshold storage:disk',
      'host_threshold storage:temp',
    ],
  },
};

test('cross-client, push: what each fixture sends, and every Web Push payload the dashboard reads', async () => {
  for (const name of STATUS_SCENARIOS) {
    for (const from of FROM) {
      const run = runScenario(name, { now: NOW });
      const events = await pushesOnto(startingSnapshot(from), run);
      assert.deepEqual(
        events.map((e) => `${e.type} ${e.id}`),
        SENT[name][from],
        `${name} from ${from}`
      );
      for (const event of events) {
        const payload = buildWebPayload(event);
        const where = `${name} from ${from}: ${event.type} ${event.id}`;
        assert.deepEqual(
          Object.keys(payload).slice(0, 7),
          ['v', 'title', 'body', 'tag', 'url', 'severity', 'type'],
          where
        );
        assert.equal(payload.severity, event.severity, where);
        assert.equal(
          deliveryOptions(event).urgency,
          event.severity === 'critical' ? 'high' : 'normal',
          where
        );
        // A push opens the entity it is about: its detail, found by the route.
        const entity = entityOf(event);
        const routes = [entityOfRoute(entityRoute(entity))];
        const subject = subjectOf(event, run.status);
        assert.equal(entity, subject.route, where);
        assert.equal(payload.tag, entity, where);
        assert.equal(payload.url, `/?entity=${entity}`, where);
        assert.deepEqual(routes, [subject.route], where);
        assert.equal(entityFor(run.status, routes[0])?.id, subject.id, where);
      }
    }
  }
});

// ── The fixtures ─────────────────────────────────────────────────────────

test('cross-client fixtures: healthy and incident are the demo boards, as the demo serves them', () => {
  for (const scenario of ['healthy', 'incident']) {
    assert.deepEqual(
      scenarioStatus(scenario, { now: NOW }),
      demoStatus({ scenario, now: NOW }),
      scenario
    );
  }
});

test('cross-client fixtures: each headline, as the model says it', () => {
  const headlines = Object.fromEntries(
    STATUS_SCENARIOS.map((name) => {
      const { overall } = scenarioStatus(name, { now: NOW });
      return [name, `${overall.state}: ${overall.sentence}`];
    })
  );
  assert.deepEqual(headlines, {
    healthy: 'ok: All 12 services up · 3 nodes healthy',
    incident: 'crit: 1 service down · 1 backup failed',
    'source-down': 'warn: Prometheus unreachable · 16 no signal',
    'first-run': 'empty: Nothing monitored yet',
    thresholds: 'crit: 1 node critical · 2 nodes in warning',
    'every-state':
      'crit: 1 node unreachable · UPS on battery · 1 container missing · 1 service pending · ' +
      '1 job overdue · 1 job failed · 1 backup overdue · 1 integration failing · 1 Arcane agent offline',
    'low-battery': 'crit: UPS low battery',
    'config-broken': "warn: services.yaml doesn't parse (line 12)",
  });
});

test('cross-client fixtures: first run has nothing to show and the empty snapshot is its baseline', () => {
  const { status } = runScenario('first-run', { now: NOW });
  assert.deepEqual(status.entities, []);
  assert.deepEqual(status.issues, []);
  // Prometheus answered the services refresh's probe (#449).
  assert.deepEqual(status.sources, { prometheus: { state: 'ok', since: NOW } });
  assert.ok(
    status.subsystems.every((s) => s.counts.total === 0),
    'no subsystem has anything'
  );
  assert.deepEqual(startingSnapshot('empty'), {
    services: {},
    monitorOf: {},
    hosts: {},
    ups: { state: 'unknown' },
    cron: {},
    sources: { prometheus: 'ok' },
  });
});

test('cross-client fixtures: the thresholds board sits on each kind of line', () => {
  const { entities } = scenarioStatus('thresholds', { now: NOW });
  const conditions = Object.fromEntries(
    entities.filter((e) => e.kind === 'node').map((e) => [e.id, e.conditions])
  );
  assert.deepEqual(conditions, {
    // CPU over its line for 2 cycles; disk 94.6 %: warn, under the crit line.
    'nodes/apps': { disk: 'warn', mem: 'ok', cpu: 'warn' },
    // Memory back at 87 %, inside the band: held at warn.
    'nodes/edge': { disk: 'ok', temp: 'ok', mem: 'warn', cpu: 'ok' },
    // Disk on its crit line; temperature over its.
    'nodes/storage': { disk: 'crit', temp: 'crit', mem: 'ok', cpu: 'ok' },
  });
});
