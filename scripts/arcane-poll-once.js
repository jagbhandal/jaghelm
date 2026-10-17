#!/usr/bin/env node
/**
 * Arcane dry run for UAT. Runs the real poller twice against a live Arcane,
 * over throwaway temp stores, so nothing touches JagHelm's data dir and no
 * push is sent. The second pass shows real transitions against the first
 * baseline.
 *
 *   ARCANE_URL=... ARCANE_API_KEY=... [ARCANE_CHECK_ONLY_ENVS=pi-1,pi-2] \
 *     node scripts/arcane-poll-once.js [--record <dir>]
 *
 * --record writes each response, projected to the fields the client reads
 * (no labels, env or anything else), under the fixture names in
 * server/arcane/fixtures/. The API key is never printed.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { readArcaneConfig } from '../server/arcane/config.js';
import { createArcaneClient } from '../server/arcane/client.js';
import { createArcaneStateStore } from '../server/arcane/stateStore.js';
import { createArcanePoller } from '../server/arcane/poller.js';
import { createHeldBackStore } from '../server/watchtower/heldBackStore.js';
import { envKey, envHealth } from '../server/arcane/derive.js';
import { projectFixture } from '../server/arcane/projectFixture.js';

const args = process.argv.slice(2);
const ri = args.indexOf('--record');
const recordDir = ri >= 0 ? resolve(args[ri + 1] || '') : null;
if (ri >= 0 && !args[ri + 1]) {
  console.error('--record needs a directory');
  process.exit(2);
}

const cfg = readArcaneConfig(process.env);
if (!cfg.enabled) {
  console.error('Set ARCANE_URL and ARCANE_API_KEY.');
  process.exit(2);
}
if (cfg.cleartext) console.error('warning: ARCANE_URL is cleartext http://');

const real = createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey });
const written = new Set();
function record(name, kind, body) {
  if (!recordDir || written.has(name)) return;
  written.add(name);
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, name), JSON.stringify(projectFixture(kind, body), null, 2) + '\n');
}
const client = {
  async listEnvironments() {
    const r = await real.listEnvironments();
    record('environments.json', 'environments', r);
    return r;
  },
  async listPendingUpdates(id) {
    const r = await real.listPendingUpdates(id);
    record('containers-has-update.json', 'containers', r);
    return r;
  },
  async listActivities(id, type, limit) {
    const r = await real.listActivities(id, type, limit);
    record(`activities-${type}.json`, 'activities', r);
    return r;
  },
  async updaterHistory(id, limit) {
    const r = await real.updaterHistory(id, limit);
    record('updater-history.json', 'history', r);
    return r;
  },
  appVersion: () => real.appVersion(),
};

const dir = mkdtempSync(join(tmpdir(), 'arcane-poll-once-'));
const stateStore = createArcaneStateStore({ path: join(dir, 'arcane-state.json') });
const heldBackStore = createHeldBackStore({ path: join(dir, 'arcane-held-back.json') });
const runs = [];
const quiet = { debug() {}, info() {}, warn: console.error, error: console.error };
const poller = createArcanePoller({
  client,
  stateStore,
  heldBackStore,
  recordRun: (r) => runs.push(r),
  dispatch: async (events) => {
    for (const e of events) console.log('  would push:', JSON.stringify(e));
  },
  pushStore: null,
  fcm: null,
  checkOnlyEnvs: cfg.checkOnlyEnvs,
  logger: quiet,
});

try {
  for (const pass of [1, 2]) {
    console.log(`--- pass ${pass}${pass === 1 ? ' (baseline)' : ''} ---`);
    const { events, errors } = await poller.pollOnce();
    console.log(JSON.stringify({ events, errors, cronRuns: runs.splice(0) }, null, 2));
    const envs = await client.listEnvironments();
    const health = {};
    const held = {};
    for (const e of envs) {
      const key = envKey(e);
      if (!key) continue;
      health[key] = envHealth(e);
      held[key] = heldBackStore.getNode(key);
    }
    console.log(JSON.stringify({ health, heldBack: held }, null, 2));
  }
  if (recordDir) {
    // Independent of the poller's own fetch gate: one history file per run.
    const envs = await client.listEnvironments();
    for (const e of envs) {
      if (envHealth(e) !== 'up' || !envKey(e)) continue;
      try {
        record('updater-history.json', 'history', await real.updaterHistory(e.id));
      } catch (err) {
        console.error(`updater-history not recorded for ${envKey(e)}:`, err?.message);
      }
    }
    try {
      record('app-version.json', 'app-version', await client.appVersion());
    } catch (err) {
      console.error('app-version not recorded:', err?.message);
    }
    console.log(`recorded: ${[...written].sort().join(', ')} -> ${recordDir}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
