/**
 * Arcane dry run (the logic behind scripts/arcane-poll-once.js).
 * Runs the real poller twice over throwaway temp stores; sends no push.
 * With --record <dir>, writes responses projected to the fields the client
 * reads, anonymized (one anonymizer for the whole recording, so a container keeps
 * one placeholder across files). Per-environment files record the first
 * environment (envKey order) whose response has rows, else the first
 * environment. The API key is never printed. Returns an exit code (0 clean, 1 a
 * pass reported read errors, 2 bad usage); never calls process.exit.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { readArcaneConfig } from './config.js';
import { createArcaneClient } from './client.js';
import { createArcaneStateStore } from './stateStore.js';
import { createArcanePoller } from './poller.js';
import { createHeldBackStore } from '../watchtower/heldBackStore.js';
import { envKey, envHealth } from './derive.js';
import { projectFixture, createAnonymizer } from './projectFixture.js';

export async function runPollOnce({
  argv = [],
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const out = (...a) => stdout.write(a.join(' ') + '\n');
  const err = (...a) => stderr.write(a.join(' ') + '\n');

  const ri = argv.indexOf('--record');
  if (ri >= 0 && !argv[ri + 1]) {
    err('--record needs a directory');
    return 2;
  }
  const recordDir = ri >= 0 ? resolve(argv[ri + 1]) : null;

  const cfg = readArcaneConfig(env, {
    logger: { warn: (...a) => err(a.filter((x) => typeof x === 'string').join(' ')) },
  });
  if (!cfg.enabled) {
    err('Set ARCANE_URL and ARCANE_API_KEY.');
    return 2;
  }
  if (cfg.cleartext) err('warning: ARCANE_URL is cleartext http://');

  const real = createArcaneClient({ baseUrl: cfg.url, apiKey: cfg.apiKey });

  // name -> Map(envKey -> raw response), for the per-environment files.
  const candidates = new Map();
  const single = new Map(); // name -> {kind, body}
  const keyById = new Map();
  const note = (name, kind, id, body) => {
    const key = keyById.get(String(id));
    if (!key) return;
    if (!candidates.has(name)) candidates.set(name, { kind, byKey: new Map() });
    candidates.get(name).byKey.set(key, body);
  };
  const client = {
    async listEnvironments() {
      const r = await real.listEnvironments();
      for (const e of r) {
        const k = envKey(e);
        if (k) keyById.set(String(e.id), k);
      }
      single.set('environments.json', { kind: 'environments', body: r });
      return r;
    },
    async listContainers(id) {
      const r = await real.listContainers(id);
      note('containers.json', 'containers', id, r);
      return r;
    },
    async listActivities(id, type, limit, start = 0) {
      const r = await real.listActivities(id, type, limit, start);
      if (!start) note(`activities-${type}.json`, 'activities', id, r); // first page only
      return r;
    },
    async updaterHistory(id, limit) {
      const r = await real.updaterHistory(id, limit);
      note('updater-history.json', 'history', id, r);
      return r;
    },
    appVersion: () => real.appVersion(),
  };

  const dir = mkdtempSync(join(tmpdir(), 'arcane-poll-once-'));
  const stateStore = createArcaneStateStore({ path: join(dir, 'arcane-state.json') });
  const heldBackStore = createHeldBackStore({ path: join(dir, 'arcane-held-back.json') });
  const runs = [];
  const poller = createArcanePoller({
    client,
    stateStore,
    heldBackStore,
    recordRun: (r) => runs.push(r),
    dispatch: async (events) => {
      for (const e of events) out('  would push:', JSON.stringify(e));
    },
    pushStore: null,
    fcm: null,
    checkOnlyEnvs: cfg.checkOnlyEnvs,
    checkEverySeconds: cfg.checkEverySeconds,
    logger: { debug() {}, info() {}, warn: (...a) => err(JSON.stringify(a[1] ?? a[0])), error: (...a) => err(JSON.stringify(a[1] ?? a[0])) },
  });

  // Exit 1 when either pass reported a read error, so a run where every read failed
  // (TLS, a missing grant) cannot pass for a clean one.
  let readErrors = false;
  const listEnvs = async () => {
    try {
      return await client.listEnvironments();
    } catch (e2) {
      readErrors = true;
      err(`environment list failed: ${e2?.message}`);
      return [];
    }
  };
  try {
    for (const pass of [1, 2]) {
      out(`--- pass ${pass}${pass === 1 ? ' (baseline)' : ''} ---`);
      const { events, errors } = await poller.pollOnce();
      if (errors.length > 0) readErrors = true;
      out(JSON.stringify({ events, errors, cronRuns: runs.splice(0) }, null, 2));
      const envs = await listEnvs();
      const health = {};
      const held = {};
      for (const e of envs) {
        const key = envKey(e);
        if (!key) continue;
        health[key] = envHealth(e);
        held[key] = heldBackStore.getNode(key);
      }
      out(JSON.stringify({ health, heldBack: held }, null, 2));
    }
    if (recordDir) {
      // History and job runs are fetched here too, independent of the poller's own gates.
      const envs = await listEnvs();
      for (const e of envs) {
        if (envHealth(e) !== 'up' || !envKey(e)) continue;
        try {
          await client.updaterHistory(e.id);
        } catch (e2) {
          err(`updater-history not recorded for ${envKey(e)}: ${e2?.message}`);
        }
        try {
          await client.listActivities(e.id, 'job_run', 50);
        } catch (e2) {
          err(`activities-job_run not recorded for ${envKey(e)}: ${e2?.message}`);
        }
      }
      try {
        single.set('app-version.json', { kind: 'app-version', body: await client.appVersion() });
      } catch (e2) {
        err(`app-version not recorded: ${e2?.message}`);
      }
      mkdirSync(recordDir, { recursive: true });
      const files = [];
      const anon = createAnonymizer();
      const write = (name, kind, body) => {
        const projected = projectFixture(kind, body, anon);
        writeFileSync(join(recordDir, name), JSON.stringify(projected, null, 2) + '\n');
        files.push(name);
      };
      for (const [name, { kind, body }] of single) write(name, kind, body);
      for (const [name, { kind, byKey }] of candidates) {
        const keys = [...byKey.keys()].sort();
        const hasRows = (b) => (Array.isArray(b) ? b : b?.data)?.length > 0;
        const pick = keys.find((k) => hasRows(byKey.get(k))) ?? keys[0];
        if (pick !== undefined) write(name, kind, byKey.get(pick));
      }
      out(`recorded: ${files.sort().join(', ')} -> ${recordDir}`);
    }
    return readErrors ? 1 : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Script entry (scripts/arcane-poll-once.js). Never rejects: an unexpected error prints
 * its message only, no stack (the message never carries the key), and exits 2.
 */
export async function main({ run = runPollOnce, stderr = process.stderr, ...opts } = {}) {
  try {
    return await run({ stderr, ...opts });
  } catch (e) {
    stderr.write(`arcane-poll-once: ${e?.message || e}\n`);
    return 2;
  }
}
