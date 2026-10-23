/**
 * Arcane agents end to end (#291): startArcane() points the status model at
 * its poller, and the loop's status step (refresh.js updateStatus) shows each
 * environment's agent as the poller last read it: offline is a warning in
 * Integrations, and it recovers when the agent is back. The poller is the real
 * one over a fake Arcane; the model makes no Arcane request of its own.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { startArcane, stopArcane } = await import('./index.js');
const { createArcanePoller } = await import('./poller.js');
const { pushSender, pushSnapshot, stopBackgroundRefresh, updateStatus } = await import('../refresh.js');

after(() => {
  stopArcane();
  stopBackgroundRefresh();
});

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const fx = (n) => {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
  return 'success' in body ? body.data : body;
};

// The fixture's four environments, all online; no containers or activities.
const envs = fx('environments').map((e) => ({ ...e, status: 'online' }));
const calls = [];
const fakeArcane = {
  listEnvironments: async () => {
    calls.push('environments');
    return structuredClone(envs);
  },
  listContainers: async () => (calls.push('containers'), []),
  listActivities: async () => (calls.push('activities'), []),
  updaterHistory: async () => (calls.push('history'), []),
  appVersion: async () => (calls.push('app-version'), {}),
};
const setStatus = (name, status) => {
  envs.find((e) => e.name === name).status = status;
};

let poller = null;
function start() {
  return startArcane({
    env: { ARCANE_URL: 'https://arcane.example.com', ARCANE_API_KEY: 'test-key-123' }, // pragma: allowlist secret
    demo: false,
    push: { snapshot: pushSnapshot, sender: pushSender }, // as boot() hands them over (#581)
    deps: {
      logger: silent,
      // The real poller over the fake Arcane, polled by the test, not by timers.
      createPoller: (opts) => {
        poller = createArcanePoller({ ...opts, client: fakeArcane, logger: silent });
        return { ...poller, start() {} };
      },
      createDigest: () => ({ start() {}, stop() {} }),
    },
  });
}

const agentsIn = (status) =>
  status.entities.filter((e) => e.kind === 'agent').map((e) => [e.id, e.subsystem, e.state, e.reason]);
const integrations = (status) => status.subsystems.find((s) => s.id === 'integrations');

let clock = Date.parse('2026-10-20T12:00:00Z');
const cycle = () => {
  clock += 30_000;
  const status = updateStatus([], clock);
  assert.ok(status, 'the model built');
  return status;
};

test('agents: Arcane not set up is no agents', () => {
  assert.deepEqual(agentsIn(cycle()), []);
});

test('agents: before the poller has read the environment list, no agents (not unknown ones)', () => {
  assert.ok(start(), 'Arcane started');
  assert.deepEqual(agentsIn(cycle()), []);
  assert.equal(calls.length, 0, 'the model asked Arcane nothing');
});

test('agents: an agent offline is a warning in Integrations, and it recovers when it is back', async () => {
  await poller.pollOnce();
  const up = cycle();
  assert.deepEqual(agentsIn(up), [
    ['integrations/arcane:pi-1', 'integrations', 'ok', 'Online'],
    ['integrations/arcane:pi-2', 'integrations', 'ok', 'Online'],
    ['integrations/arcane:vm-101', 'integrations', 'ok', 'Online'],
    ['integrations/arcane:vm-103', 'integrations', 'ok', 'Online'],
  ]);
  assert.equal(integrations(up).state, 'ok');

  setStatus('vm-101', 'offline');
  await poller.pollOnce();
  const before = calls.length;
  const down = cycle();
  const vm101 = down.entities.find((e) => e.id === 'integrations/arcane:vm-101');
  assert.deepEqual(
    [vm101.kind, vm101.state, vm101.word, vm101.reason, vm101.name],
    ['agent', 'warn', 'Offline', 'Arcane: agent offline', 'Arcane agent vm-101']
  );
  assert.equal(vm101.since, clock, 'offline since this cycle');
  assert.deepEqual(integrations(down).state, 'warn');
  assert.equal(integrations(down).detail, '3 / 4 OK');
  assert.deepEqual(down.overall, { state: 'warn', sentence: '1 Arcane agent offline' });
  assert.deepEqual(down.issues.map((i) => i.id), ['integrations/arcane:vm-101']);
  // Held while the poller says so: every cycle between two polls.
  assert.equal(cycle().entities.find((e) => e.id === vm101.id).since, vm101.since);
  assert.equal(calls.length, before, 'the model asked Arcane nothing');

  setStatus('vm-101', 'online');
  await poller.pollOnce();
  const back = cycle();
  const recovered = back.entities.find((e) => e.id === 'integrations/arcane:vm-101');
  assert.deepEqual([recovered.state, recovered.reason], ['ok', 'Online']);
  assert.equal(recovered.since, clock, 'back since this cycle');
  assert.deepEqual(back.issues, []);
  assert.equal(integrations(back).state, 'ok');
});

test('agents: Arcane stopped is no agents again', () => {
  stopArcane();
  assert.deepEqual(agentsIn(cycle()), []);
});
