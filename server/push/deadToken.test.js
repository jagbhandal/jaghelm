/**
 * The retired Android app's FCM token (#659, stage A): the app is uninstalled,
 * so FCM answers every send to its token with 404 UNREGISTERED. That must cost
 * one warn line and the token, never an error flood, a retry or a held-up
 * outbox. The real sendToToken (fcm.js, which classifies the answer) feeds the
 * real outbox: the dead token is pruned, a live phone gets the same event
 * from the same round, and later events never try the dead token again.
 * The classification of each FCM answer is tested in fcm.test.js and
 * fcmHttp.test.js; the outbox's handling of a prune in outbox.test.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as realFcm from './fcm.js';
import { createPushSnapshot, runPushCycle } from './dispatch.js';
import { createPushSender } from './outbox.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/fcm-wire-golden.json', import.meta.url), 'utf8'));
const UNREGISTERED = golden.errors.find((e) => e.name === 'UNREGISTERED');
const T0 = 1_782_345_600_000;

/** A snapshot with services a to c on n1, each up unless named down. */
const board = (...down) => ({
  services: Object.fromEntries(['a', 'b', 'c'].map((s) => [`n1:${s}`, down.includes(s) ? 'down' : 'up'])),
  hosts: {},
  ups: { state: 'online' },
  cron: {},
});

function recording() {
  const lines = [];
  const at = (level) => (fields, msg) => lines.push({ level, fields, msg });
  return { lines, debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}

test('a removed app\'s token, answered 404 UNREGISTERED: pruned after one warn line, nothing retried, the live phone and the outbox unharmed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-659-dead-'));
  const creds = join(dir, 'sa.json');
  writeFileSync(creds, JSON.stringify({ client_email: 'a@b.iam.gserviceaccount.com', private_key: 'x', project_id: 'p' })); // pragma: allowlist secret
  const log = recording();
  const sends = [];
  realFcm.initPush({
    credsPath: creds,
    env: {},
    logger: log,
    messagingFactory: () => ({
      // What the FCM client throws for this answer (the golden fixture is Google's own).
      async send(message) {
        sends.push(message.token);
        if (message.token === 'removed-app-token') {
          throw Object.assign(new Error(UNREGISTERED.message), { code: UNREGISTERED.code, status: UNREGISTERED.status });
        }
        return 'projects/p/messages/1';
      },
    }),
  });
  const removed = [];
  const delivered = [];
  const store = {
    getAllTokens: () =>
      ['removed-app-token', 'live-phone'].filter((t) => !removed.includes(t)).map((token) => ({ token })),
    getPrefs: () => ({
      enabled: true,
      notifyRecoveries: true,
      categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    }),
    removeToken: (t) => removed.push(t),
    pruneStale: () => 0,
    markDelivered: (list) => delivered.push(...list),
  };
  const now = () => T0;
  const sleeps = [];
  const snapshot = createPushSnapshot({ path: join(dir, 'push-snapshot.json'), logger: log, now });
  const sender = createPushSender({
    outbox: snapshot,
    store,
    fcm: realFcm,
    logger: log,
    now,
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise(() => {});
    },
  });
  const cycle = async (snap) => {
    await runPushCycle({ buildSnapshotFn: () => snap, store, fcm: realFcm, snapshot, sender, logger: log });
    await sender.idle();
  };
  try {
    await cycle(board());
    await cycle(board('a'));
    await cycle(board('a', 'b'));

    assert.deepEqual(removed, ['removed-app-token'], 'the dead token is pruned');
    assert.deepEqual(
      sends,
      ['removed-app-token', 'live-phone', 'live-phone'],
      'the dead token is tried once; the live phone gets every event'
    );
    assert.deepEqual(delivered.filter((t) => t === 'live-phone').length > 0, true);
    assert.deepEqual(sleeps, [], 'no retry wait: a dead token is not Google being out of reach');
    assert.deepEqual(snapshot.outbox(), [], 'the outbox is empty');
    const failed = log.lines.filter((l) => l.msg === 'fcm send failed');
    assert.equal(failed.length, 1, 'one warn line for the dead token, once');
    assert.equal(failed[0].level, 'warn');
    assert.equal(failed[0].fields.code, 'messaging/registration-token-not-registered');
    assert.equal(failed[0].fields.prune, true);
    assert.equal(log.lines.filter((l) => l.level === 'error').length, 0, 'no error line');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
