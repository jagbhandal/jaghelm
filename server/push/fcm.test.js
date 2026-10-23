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
  const logger = makeLogger();
  initPush({ credsPath: path, env: {}, messagingFactory, logger });
  return { dir, sent, logger };
}

// An error shaped like the client's FcmError (and firebase-admin's before it): a `code` and a message.
const fcmError = (code, message) => Object.assign(new Error(message), { code });

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

test('sendToToken prune: invalid-argument naming the registration token => {ok:false, prune:true}', async () => {
  const { dir } = enableWithSend(() => Promise.reject(
    fcmError('messaging/invalid-argument', 'The registration token is not a valid FCM registration token'),
  ));
  try {
    const res = await sendToToken('tok-bad', sampleEvent);
    assert.equal(res.ok, false);
    assert.equal(res.prune, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken prune: legacy invalid-registration-token => {ok:false, prune:true}', async () => {
  const { dir } = enableWithSend(() => Promise.reject(
    fcmError('messaging/invalid-registration-token', 'Invalid registration token provided.'),
  ));
  try {
    const res = await sendToToken('tok-bad', sampleEvent);
    assert.equal(res.prune, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken keeps the token on an invalid-argument payload error, and logs why', async () => {
  // v1 INVALID_ARGUMENT for a bad payload: the client gives it the same code as a bad token.
  const { dir, logger } = enableWithSend(() => Promise.reject(
    fcmError('messaging/invalid-argument', "Invalid value at 'message.data[0].value' (TYPE_STRING), 12"),
  ));
  try {
    const res = await sendToToken('tok-live', sampleEvent);
    assert.deepEqual(res, { ok: false, prune: false, retry: false, allPhones: false, error: 'messaging/invalid-argument' });
    const [fields] = logger._calls.warn.at(-1);
    assert.equal(fields.prune, false);
    assert.match(fields.message, /message\.data\[0\]\.value/, 'the payload problem is logged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sendToToken keeps the token on a non-JSON 400 (proxy or HTML error page)', async () => {
  // A non-JSON 400 maps to invalid-argument (fcmHttp.js, as firebase-admin did).
  const raw = `<html>${'x'.repeat(1000)}</html>`;
  const { dir, logger } = enableWithSend(() => Promise.reject(
    fcmError('messaging/invalid-argument', `Invalid argument provided. Raw server response: "${raw}". Status code: 400.`),
  ));
  try {
    const res = await sendToToken('tok-live', sampleEvent);
    assert.equal(res.prune, false);
    const [fields] = logger._calls.warn.at(-1);
    assert.ok(fields.message.length <= 200, 'the logged message is truncated');
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

// #579: a failure that says nothing about the message or the token is sent
// again later (push/outbox.js); one that is the message's or the token's own is
// not. `allPhones`: it would fail for every phone alike (Google out of reach,
// the key refused), so the outbox waits instead of trying the next phone.
test('sendToToken retry: Google out of reach or the key refused => retry, all phones; Google failing or the quota => retry, this phone; the message or the token at fault => no retry', async () => {
  const everyPhone = [
    'app/network-error',
    'app/network-timeout',
    'app/invalid-credential',
    'messaging/authentication-error',
    'messaging/third-party-auth-error',
  ];
  const thisPhone = ['messaging/server-unavailable', 'messaging/internal-error', 'messaging/message-rate-exceeded'];
  const final = [
    'messaging/registration-token-not-registered',
    'messaging/invalid-argument',
    'messaging/invalid-payload',
    'messaging/payload-size-limit-exceeded',
    'messaging/device-message-rate-exceeded',
    'messaging/mismatched-credential',
    'messaging/unknown-error',
  ];
  let code;
  const { dir } = enableWithSend(() => Promise.reject(fcmError(code, 'no')));
  try {
    const outcome = async () => {
      const res = await sendToToken('tok', sampleEvent);
      return [code, res.ok, res.prune, res.retry, res.allPhones];
    };
    for (code of everyPhone) assert.deepEqual(await outcome(), [code, false, false, true, true]);
    for (code of thisPhone) assert.deepEqual(await outcome(), [code, false, false, true, false]);
    for (code of final) assert.deepEqual(await outcome(), [code, false, code.includes('not-registered'), false, false]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// #579 review: an answer the client has no code for (a 502 or 504 from Google's
// front end, a 429 that is not JSON) is `unknown-error`; its HTTP status says
// whether it is worth sending again.
test('sendToToken retry: any 5xx or 429 FCM answered is sent again, for this phone; other statuses are not', async () => {
  let failure;
  const { dir } = enableWithSend(() => Promise.reject(failure));
  const answered = (code, status) => Object.assign(fcmError(code, 'no'), { status });
  try {
    for (const [code, status, retry] of [
      ['messaging/unknown-error', 502, true],
      ['messaging/unknown-error', 504, true],
      ['messaging/unknown-error', 429, true],
      ['messaging/device-message-rate-exceeded', 429, true],
      ['messaging/unknown-error', 418, false],
      ['messaging/mismatched-credential', 403, false],
      ['messaging/invalid-argument', 400, false],
    ]) {
      failure = answered(code, status);
      const res = await sendToToken('tok', sampleEvent);
      assert.deepEqual([code, status, res.retry, res.allPhones], [code, status, retry, false]);
    }
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
// Task 25: guard — disabled path never builds the FCM client
// ─────────────────────────────────────────────────────────────────────────────

test('no creds => default messagingFactory never invoked (no FCM client built)', () => {
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

test('the factory is synchronous: push is on as initPush returns, and a promise is not a messaging', () => {
  const { dir, path } = fakeServiceAccountFile();
  try {
    initPush({ credsPath: path, env: {}, messagingFactory: () => ({ send: () => Promise.resolve('id') }), logger: makeLogger() });
    assert.equal(isPushEnabled(), true, 'on at once');

    const logger = makeLogger();
    const pending = Promise.resolve({ send: () => Promise.resolve('id') });
    initPush({ credsPath: path, env: {}, messagingFactory: () => pending, logger });
    assert.equal(isPushEnabled(), false, 'an async factory leaves push off');
    assert.ok(logger._calls.warn.some((args) => args.includes('push disabled: messaging factory returned no usable messaging')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
