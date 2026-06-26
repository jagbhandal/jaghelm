import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { initPush, isPushEnabled, buildMessage, sendToToken } from './fcm.js';

// A logger that records calls so we can assert "logged, never threw".
function makeLogger() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    debug: (...a) => calls.debug.push(a),
    child() { return this; },
    _calls: calls,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 20: graceful-disable — no creds path
// ─────────────────────────────────────────────────────────────────────────────

test('graceful disable: no credsPath and empty env => disabled, no throw', () => {
  const logger = makeLogger();
  assert.doesNotThrow(() => {
    initPush({ credsPath: undefined, env: {}, messagingFactory: () => { throw new Error('factory must not be called'); }, logger });
  });
  assert.equal(isPushEnabled(), false);
  // It should announce the disabled state at info level, not throw or error.
  assert.equal(logger._calls.error.length, 0);
  assert.ok(logger._calls.info.length >= 1, 'expected an info log explaining push is disabled');
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 21: invalid creds path => disabled, no throw
// ─────────────────────────────────────────────────────────────────────────────

test('invalid creds path: nonexistent file => disabled, no throw', () => {
  const logger = makeLogger();
  assert.doesNotThrow(() => {
    initPush({
      credsPath: '/definitely/not/a/real/path/sa.json',
      env: {},
      messagingFactory: () => { throw new Error('factory must not be called'); },
      logger,
    });
  });
  assert.equal(isPushEnabled(), false);
  assert.equal(logger._calls.error.length, 0);
  assert.ok(logger._calls.warn.length >= 1, 'expected a warn log for unreadable creds');
});

test('invalid creds content: malformed JSON => disabled, no throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcm-'));
  const bad = join(dir, 'sa.json');
  writeFileSync(bad, '{ this is not json ');
  try {
    const logger = makeLogger();
    assert.doesNotThrow(() => {
      initPush({
        credsPath: bad,
        env: {},
        messagingFactory: () => { throw new Error('factory must not be called'); },
        logger,
      });
    });
    assert.equal(isPushEnabled(), false);
    assert.ok(logger._calls.warn.length >= 1, 'expected a warn log for malformed JSON');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 22: valid creds => isPushEnabled() true via injected messagingFactory
// ─────────────────────────────────────────────────────────────────────────────

function fakeServiceAccountFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcm-'));
  const path = join(dir, 'sa.json');
  const sa = { project_id: 'jaghelm-test', client_email: 'svc@example.com', private_key: 'PEM' };
  writeFileSync(path, JSON.stringify(sa));
  return { dir, path, sa };
}

test('valid creds: injected factory => enabled, factory got parsed service account', () => {
  const { dir, path, sa } = fakeServiceAccountFile();
  try {
    const logger = makeLogger();
    const sendCalls = [];
    const fakeMessaging = { send: (msg) => { sendCalls.push(msg); return Promise.resolve('mock-msg-id'); } };
    const factoryArgs = [];
    const messagingFactory = (serviceAccount) => { factoryArgs.push(serviceAccount); return fakeMessaging; };

    initPush({ credsPath: path, env: {}, messagingFactory, logger });

    assert.equal(isPushEnabled(), true);
    assert.equal(factoryArgs.length, 1, 'factory called exactly once');
    assert.deepEqual(factoryArgs[0], sa, 'factory received the parsed service account');
    assert.equal(logger._calls.error.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FCM_SERVICE_ACCOUNT env resolves when credsPath absent', () => {
  const { dir, path } = fakeServiceAccountFile();
  try {
    initPush({ env: { FCM_SERVICE_ACCOUNT: path }, messagingFactory: () => ({ send: () => Promise.resolve('id') }), logger: makeLogger() });
    assert.equal(isPushEnabled(), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 23: buildMessage — PURE message shape (severity => android.priority, channelId)
// ─────────────────────────────────────────────────────────────────────────────

test('buildMessage: critical event => exact shape, android.priority high', () => {
  const event = {
    type: 'service_down', id: 'web', node: 'vm-101',
    title: 'Service down: web', body: 'web on vm-101 is down',
    severity: 'critical', prev: 'up', next: 'down',
  };
  const msg = buildMessage('tok-123', event);
  assert.deepEqual(msg, {
    token: 'tok-123',
    notification: { title: 'Service down: web', body: 'web on vm-101 is down' },
    data: { type: 'service_down', id: 'web', node: 'vm-101', severity: 'critical' },
    android: {
      priority: 'high',
      notification: { channelId: 'jaghelm-incidents' },
    },
  });
});

test('buildMessage: warning event => android.priority normal', () => {
  const event = { type: 'cron_failed', id: 'backup', node: 'vm-103', title: 'Cron failed', body: 'backup failed', severity: 'warning' };
  const msg = buildMessage('tok-9', event);
  assert.equal(msg.android.priority, 'normal');
  assert.equal(msg.android.notification.channelId, 'jaghelm-incidents');
});

test('buildMessage: info event => android.priority normal', () => {
  const event = { type: 'service_recovered', id: 'web', node: 'vm-101', title: 'Recovered', body: 'web up', severity: 'info' };
  assert.equal(buildMessage('t', event).android.priority, 'normal');
});

test('buildMessage is PURE: same input => byte-identical output, no input mutation', () => {
  const event = { type: 'ups_on_battery', id: 'ups', node: 'pdu', title: 'On battery', body: 'mains lost', severity: 'critical' };
  const frozen = Object.freeze({ ...event });
  const a = buildMessage('t', frozen);
  const b = buildMessage('t', frozen);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // data carries ONLY the four contract keys — not prev/next/title/body.
  assert.deepEqual(Object.keys(a.data).sort(), ['id', 'node', 'severity', 'type']);
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 24: sendToToken — success / prune / transient classification
// ─────────────────────────────────────────────────────────────────────────────

// Helper: enable push with a fake messaging whose send() is driven per-test.
function enableWithSend(sendImpl) {
  const { dir, path } = fakeServiceAccountFile();
  const sent = [];
  const messagingFactory = () => ({
    send: (msg) => { sent.push(msg); return sendImpl(msg); },
  });
  initPush({ credsPath: path, env: {}, messagingFactory, logger: makeLogger() });
  return { dir, sent };
}

const sampleEvent = {
  type: 'service_down', id: 'web', node: 'vm-101',
  title: 'Service down: web', body: 'web is down', severity: 'critical',
};

test('sendToToken success: send resolves => {ok:true, prune:false} and got buildMessage payload', async () => {
  const { dir, sent } = enableWithSend(() => Promise.resolve('msg-id-1'));
  try {
    const res = await sendToToken('tok-ok', sampleEvent);
    assert.deepEqual(res, { ok: true, prune: false });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], buildMessage('tok-ok', sampleEvent));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken prune: registration-token-not-registered => {ok:false, prune:true}', async () => {
  const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('gone'), { code: 'messaging/registration-token-not-registered' })));
  try {
    const res = await sendToToken('tok-dead', sampleEvent);
    assert.equal(res.ok, false);
    assert.equal(res.prune, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken prune: invalid-argument => {ok:false, prune:true}', async () => {
  const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('bad'), { code: 'messaging/invalid-argument' })));
  try {
    const res = await sendToToken('tok-bad', sampleEvent);
    assert.equal(res.ok, false);
    assert.equal(res.prune, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken transient: internal-error => {ok:false, prune:false}', async () => {
  const { dir } = enableWithSend(() => Promise.reject(Object.assign(new Error('try later'), { code: 'messaging/internal-error' })));
  try {
    const res = await sendToToken('tok-x', sampleEvent);
    assert.equal(res.ok, false);
    assert.equal(res.prune, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken when disabled: => {ok:false, prune:false}, no throw', async () => {
  initPush({ env: {}, messagingFactory: () => { throw new Error('unused'); }, logger: makeLogger() });
  assert.equal(isPushEnabled(), false);
  const res = await sendToToken('tok', sampleEvent);
  assert.deepEqual(res, { ok: false, prune: false });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 25: guard — disabled path never loads firebase-admin
// ─────────────────────────────────────────────────────────────────────────────

test('no creds => default messagingFactory never invoked (firebase-admin untouched)', () => {
  let factoryInvoked = false;
  initPush({ env: {}, messagingFactory: () => { factoryInvoked = true; return {}; }, logger: makeLogger() });
  assert.equal(factoryInvoked, false);
  assert.equal(isPushEnabled(), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 2: factory returning object without .send => isPushEnabled() false
// ─────────────────────────────────────────────────────────────────────────────

test('factory returning {} (no .send) => isPushEnabled() false', () => {
  const { dir, path } = fakeServiceAccountFile();
  try {
    const logger = makeLogger();
    // Factory returns a plain object with no .send — should NOT enable push.
    initPush({ credsPath: path, env: {}, messagingFactory: () => ({}), logger });
    assert.equal(isPushEnabled(), false);
    assert.ok(
      logger._calls.warn.some((args) => args.some((a) => typeof a === 'string' && a.includes('no usable messaging'))),
      'expected a warn about no usable messaging',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Fix 3: GOOGLE_APPLICATION_CREDENTIALS fallback => isPushEnabled() true
// ─────────────────────────────────────────────────────────────────────────────

test('GOOGLE_APPLICATION_CREDENTIALS env fallback with injected factory => isPushEnabled() true', () => {
  const { dir, path } = fakeServiceAccountFile();
  try {
    const logger = makeLogger();
    const fakeMessaging = { send: async () => {} };
    initPush({
      credsPath: undefined,
      env: { GOOGLE_APPLICATION_CREDENTIALS: path },
      messagingFactory: () => fakeMessaging,
      logger,
    });
    assert.equal(isPushEnabled(), true);
    assert.equal(logger._calls.error.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
