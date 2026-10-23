/**
 * The FCM HTTP v1 client (#235) against what firebase-admin did before it was
 * removed. fixtures/fcm-wire-golden.json was captured from firebase-admin
 * 14.2.0 with its HTTP layer routed to a local server: the exact body it sent
 * for every message JagHelm builds, the token exchange it made, and what it
 * threw (and how many requests it made) for each canned FCM answer. Nothing
 * here touches the network: every test hands the client a fake fetch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { createFcmHttpClient, FCM_SCOPE, FcmError, toWireMessage } from './fcmHttp.js';
import { buildMessage, initPush, isPushEnabled, sendToToken } from './fcm.js';

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/fcm-wire-golden.json', import.meta.url), 'utf8')
);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function serviceAccount(overrides = {}) {
  return {
    type: 'service_account',
    project_id: golden.projectId,
    private_key_id: 'test',
    private_key: PEM,
    client_email: golden.clientEmail,
    token_uri: 'https://oauth2.googleapis.com/token',
    ...overrides,
  };
}

function recordingLogger() {
  const lines = [];
  const at =
    (level) =>
    (...args) =>
      lines.push({ level, args });
  return {
    lines,
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child() {
      return this;
    },
  };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  });
const TEST_ACCESS = 'ya29.test-access-token';
const tokenOk = (accessToken = TEST_ACCESS, expiresIn = 3599) =>
  json(200, { access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' });
const sent = (n = 1) => json(200, { name: `projects/${golden.projectId}/messages/${n}` });

/**
 * A fake Google: `token` and `fcm` answer the two endpoints (a Response, or a
 * function of the call and its index giving one, or throwing). Records every call.
 */
function fakeGoogle({ token = () => tokenOk(), fcm = () => sent() } = {}) {
  const calls = [];
  const counts = { token: 0, fcm: 0 };
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const call = {
      url: String(url),
      origin: u.origin,
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body,
      redirect: init.redirect,
      signal: init.signal,
    };
    calls.push(call);
    if (u.origin === 'https://oauth2.googleapis.com') return answer(token, call, counts.token++);
    if (u.origin === 'https://fcm.googleapis.com') return answer(fcm, call, counts.fcm++);
    throw new Error(`unexpected egress to ${u.origin}`);
  }
  async function answer(spec, call, i) {
    return typeof spec === 'function' ? spec(call, i) : spec;
  }
  return {
    fetch,
    calls,
    tokenCalls: () => calls.filter((c) => c.origin === 'https://oauth2.googleapis.com'),
    fcmCalls: () => calls.filter((c) => c.origin === 'https://fcm.googleapis.com'),
  };
}

function client(google, opts = {}) {
  return createFcmHttpClient(serviceAccount(opts.sa), {
    fetch: google.fetch,
    sleep: async () => {},
    logger: recordingLogger(),
    ...opts,
  });
}

function decodeJwt(assertion) {
  const [h, c, s] = assertion.split('.');
  const part = (p) => JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  return {
    header: part(h),
    claims: part(c),
    input: `${h}.${c}`,
    signature: Buffer.from(s, 'base64url'),
  };
}

const EVENT = golden.messages.find((m) => m.event.type === 'service_down').event;

// ─────────────────────────────────────────────────────────────────────────────
// The token exchange
// ─────────────────────────────────────────────────────────────────────────────

test('the JWT is RS256, verifies against the service account key, and has the claims firebase-admin sent', async () => {
  const google = fakeGoogle();
  const now = 1_800_000_000_123;
  await client(google, { now: () => now }).send(buildMessage(golden.recipient, EVENT));

  const form = new URLSearchParams(google.tokenCalls()[0].body);
  const jwt = decodeJwt(form.get('assertion'));
  assert.ok(
    verify('sha256', Buffer.from(jwt.input), publicKey, jwt.signature),
    'signed by the service account key'
  );
  assert.deepEqual(jwt.header, golden.tokenRequest.jwtHeader);
  assert.deepEqual(
    Object.keys(jwt.claims),
    golden.tokenRequest.jwtClaimKeys,
    'the same claims, no sub'
  );
  const { iss, aud, lifetimeSeconds } = golden.tokenRequest.jwtClaims;
  assert.equal(jwt.claims.iss, iss);
  assert.equal(jwt.claims.aud, aud);
  assert.equal(jwt.claims.iat, Math.floor(now / 1000));
  assert.equal(jwt.claims.exp - jwt.claims.iat, lifetimeSeconds);
  // Narrower than firebase-admin's five scopes: only the one FCM v1 send needs.
  assert.equal(jwt.claims.scope, FCM_SCOPE);
  assert.ok(golden.tokenRequest.jwtClaims.scope.split(' ').includes(FCM_SCOPE));
});

test('the token exchange is the request firebase-admin made', async () => {
  const google = fakeGoogle();
  await client(google).send(buildMessage(golden.recipient, EVENT));
  const [call] = google.tokenCalls();
  assert.equal(call.url, golden.tokenRequest.url);
  assert.equal(call.method, golden.tokenRequest.method);
  assert.equal(call.headers.get('content-type'), golden.tokenRequest.contentType);
  const form = new URLSearchParams(call.body);
  assert.deepEqual([...form.keys()], golden.tokenRequest.formKeys);
  assert.equal(form.get('grant_type'), golden.tokenRequest.grantType);
});

test('the access token is cached, and exchanged again 5 minutes before it expires', async () => {
  const google = fakeGoogle({ token: (_c, i) => tokenOk(`ya29.token-${i}`, 3600) });
  let now = 1_800_000_000_000;
  const c = client(google, { now: () => now });
  const msg = buildMessage(golden.recipient, EVENT);

  await c.send(msg);
  now += 54 * 60_000 + 59_000; // 5 min 1 s left
  await c.send(msg);
  assert.equal(google.tokenCalls().length, 1, 'still fresh: no second exchange');
  now += 1_000; // 5 min left
  await c.send(msg);
  assert.equal(google.tokenCalls().length, 2, 'refreshed before it expires');
  assert.deepEqual(
    google.fcmCalls().map((f) => f.headers.get('authorization')),
    ['Bearer ya29.token-0', 'Bearer ya29.token-0', 'Bearer ya29.token-1']
  );
});

test('concurrent sends share one token exchange (single-flight)', async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const google = fakeGoogle({
    token: async () => {
      await gate;
      return tokenOk('ya29.shared');
    },
  });
  const c = client(google);
  const sends = Array.from({ length: 5 }, () => c.send(buildMessage(golden.recipient, EVENT)));
  await new Promise((r) => setImmediate(r));
  assert.equal(google.tokenCalls().length, 1, 'one exchange in flight for five sends');
  release();
  const names = await Promise.all(sends);
  assert.equal(names.length, 5);
  assert.equal(google.tokenCalls().length, 1);
  assert.ok(
    google.fcmCalls().every((f) => f.headers.get('authorization') === 'Bearer ya29.shared')
  );
});

test('a failed exchange fails every send waiting on it, is not cached, and the next send tries again', async () => {
  const google = fakeGoogle({
    token: (_c, i) =>
      i === 0
        ? json(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
        : tokenOk(),
  });
  const logger = recordingLogger();
  const c = client(google, { logger });
  const msg = buildMessage(golden.recipient, EVENT);
  const results = await Promise.allSettled([c.send(msg), c.send(msg)]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['rejected', 'rejected']
  );
  for (const r of results) {
    assert.ok(r.reason instanceof FcmError);
    assert.equal(
      r.reason.code,
      'app/invalid-credential',
      'the code firebase-admin gave a failed exchange'
    );
    assert.match(r.reason.message, /invalid_grant: Invalid JWT Signature\./);
  }
  assert.equal(google.tokenCalls().length, 1);
  assert.equal(google.fcmCalls().length, 0, 'nothing sent without a token');
  const [warn] = logger.lines.filter((l) => l.level === 'warn');
  assert.deepEqual(warn.args, [
    { status: 400, reason: 'invalid_grant: Invalid JWT Signature.' },
    'fcm access token request failed',
  ]);

  await c.send(msg);
  assert.equal(google.tokenCalls().length, 2, 'a failure is not cached');
});

test('a token answer without an access token or a lifetime is a failed exchange', async () => {
  for (const body of [
    { expires_in: 3599 },
    { access_token: 'ya29.x' },
    { access_token: '', expires_in: 3599 },
  ]) {
    const google = fakeGoogle({ token: json(200, body) });
    await assert.rejects(client(google).send(buildMessage(golden.recipient, EVENT)), {
      code: 'app/invalid-credential',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The send: byte-identical bodies
// ─────────────────────────────────────────────────────────────────────────────

test('every message kind goes on the wire byte for byte as firebase-admin sent it', async (t) => {
  assert.ok(golden.messages.length >= 20, 'the fixture covers every kind');
  for (const { name, event, body } of golden.messages) {
    await t.test(name, async () => {
      const google = fakeGoogle();
      const id = await client(google).send(buildMessage(golden.recipient, event));
      assert.equal(id, `projects/${golden.projectId}/messages/1`);
      const [call] = google.fcmCalls();
      assert.equal(call.body, body, 'the same bytes');
      assert.deepEqual(JSON.parse(call.body), JSON.parse(body));
      assert.equal(call.url, golden.request.url);
      assert.equal(call.method, golden.request.method);
      assert.equal(call.headers.get('content-type'), golden.request.contentType);
      assert.equal(call.headers.get('authorization'), 'Bearer ya29.test-access-token');
    });
  }
});

test('a message the client cannot put on the wire as firebase-admin did is refused before any request', async () => {
  const google = fakeGoogle();
  const c = client(google);
  const msg = buildMessage(golden.recipient, EVENT);
  const refused = [
    { ...msg, apns: {} },
    { ...msg, android: { ...msg.android, ttl: 3600 } },
    {
      ...msg,
      android: { ...msg.android, notification: { ...msg.android.notification, clickAction: 'x' } },
    },
    { ...msg, notification: { ...msg.notification, imageUrl: 'https://x' } },
    { ...msg, data: { ...msg.data, n: 12 } },
    { ...msg, token: '' },
    null,
  ];
  for (const m of refused) {
    await assert.rejects(
      c.send(m),
      (err) => err instanceof FcmError && err.code === 'messaging/invalid-payload'
    );
  }
  assert.equal(google.calls.length, 0);
  assert.throws(() => toWireMessage({ ...msg, topic: 'x' }), { code: 'messaging/invalid-payload' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors: the same outcomes as firebase-admin
// ─────────────────────────────────────────────────────────────────────────────

/** A canned answer from the fixture, as a fresh Response (or a dropped connection). */
function cannedAnswer(e) {
  if (e.status === 0) {
    return () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('other side closed'), { code: 'ECONNRESET' }),
      });
    };
  }
  return () =>
    new Response(e.response, { status: e.status, headers: { 'content-type': e.contentType } });
}

test('each FCM error gives the code firebase-admin gave, after the same number of attempts', async (t) => {
  for (const e of golden.errors) {
    await t.test(e.name, async () => {
      const google = fakeGoogle({ fcm: cannedAnswer(e) });
      const err = await client(google)
        .send(buildMessage(golden.recipient, EVENT))
        .then(
          () => assert.fail('expected a rejection'),
          (x) => x
        );
      assert.ok(err instanceof FcmError);
      assert.equal(err.code, e.code);
      // A 401 is retried once with a new token (firebase-admin did not retry it).
      assert.equal(google.fcmCalls().length, e.status === 401 ? 2 : e.attempts);
      const raw = e.contentType === 'application/json' ? JSON.parse(e.response) : null;
      if (raw && e.code !== 'messaging/unknown-error')
        assert.equal(err.message, e.message, "FCM's own message");
      if (e.response)
        assert.ok(!err.message.includes(e.response), 'the raw response is never quoted');
    });
  }
});

test('sendToToken over the client prunes, keeps and reports exactly as it did over firebase-admin', async (t) => {
  const { dir, path } = saFile();
  try {
    for (const e of golden.errors) {
      await t.test(e.name, async () => {
        // Before: the error firebase-admin threw for this answer, with the
        // answer's HTTP status, which the outbox's retry also reads (#579).
        initPush({
          credsPath: path,
          env: {},
          logger: recordingLogger(),
          messagingFactory: () => ({
            send: () =>
              Promise.reject(Object.assign(new Error(e.message), { code: e.code, status: e.status })),
          }),
        });
        const before = await sendToToken(golden.recipient, EVENT);
        // Now: the client against the same answer.
        const google = fakeGoogle({ fcm: cannedAnswer(e) });
        initPush({
          credsPath: path,
          env: {},
          logger: recordingLogger(),
          messagingFactory: clientFactory(google),
        });
        const now = await sendToToken(golden.recipient, EVENT);
        assert.deepEqual(now, before);
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UNREGISTERED prunes; INVALID_ARGUMENT prunes only when it names the registration token (#343)', async () => {
  const outcome = async (name) => {
    const google = fakeGoogle({ fcm: cannedAnswer(golden.errors.find((e) => e.name === name)) });
    initPush({
      credsPath: sa.path,
      env: {},
      logger: recordingLogger(),
      messagingFactory: clientFactory(google),
    });
    return sendToToken(golden.recipient, EVENT);
  };
  const sa = saFile();
  try {
    assert.equal((await outcome('UNREGISTERED')).prune, true);
    assert.equal((await outcome('INVALID_ARGUMENT naming the token')).prune, true);
    assert.deepEqual(await outcome('INVALID_ARGUMENT for the payload'), {
      ok: false,
      prune: false,
      retry: false,
      allPhones: false,
      error: 'messaging/invalid-argument',
    });
    assert.equal((await outcome('INVALID_ARGUMENT, message too big')).prune, false);
    assert.equal((await outcome('non-JSON 400')).prune, false);
    assert.equal((await outcome('SENDER_ID_MISMATCH')).prune, false);
    // #579: none of them is the outbox's to send again.
    assert.equal((await outcome('SENDER_ID_MISMATCH')).retry, false);
    assert.equal((await outcome('UNREGISTERED')).retry, false);
    // An answer with no code the client knows: its HTTP status decides (#579 review).
    assert.equal((await outcome('unknown status, no FCM detail')).retry, false, 'a 409 is not sent again');
    assert.equal((await outcome('non-JSON 500')).retry, true);
  } finally {
    rmSync(sa.dir, { recursive: true, force: true });
  }
});

test('a successful send through sendToToken is ok and never prunes', async () => {
  const sa = saFile();
  try {
    const google = fakeGoogle();
    initPush({
      credsPath: sa.path,
      env: {},
      logger: recordingLogger(),
      messagingFactory: clientFactory(google),
    });
    assert.deepEqual(await sendToToken(golden.recipient, EVENT), { ok: true, prune: false });
  } finally {
    rmSync(sa.dir, { recursive: true, force: true });
  }
});

test('a 401 drops the cached token, exchanges a new one and retries once', async () => {
  const google = fakeGoogle({
    token: (_c, i) => tokenOk(`ya29.token-${i}`),
    fcm: (_c, i) =>
      i === 0
        ? json(401, {
            error: {
              code: 401,
              message: 'Request had invalid authentication credentials.',
              status: 'UNAUTHENTICATED',
            },
          })
        : sent(),
  });
  const c = client(google);
  await c.send(buildMessage(golden.recipient, EVENT));
  assert.equal(google.tokenCalls().length, 2);
  assert.deepEqual(
    google.fcmCalls().map((f) => f.headers.get('authorization')),
    ['Bearer ya29.token-0', 'Bearer ya29.token-1']
  );
  // The new token is the cached one now.
  await c.send(buildMessage(golden.recipient, EVENT));
  assert.equal(google.tokenCalls().length, 2);
});

test('503 and dropped connections are retried as firebase-admin did: 4 times, 0/1/2/4 s apart, or Retry-After', async () => {
  const delays = [];
  const sleep = async (ms) => {
    delays.push(ms);
  };
  const unavailable = golden.errors.find((e) => e.name === 'UNAVAILABLE');

  let google = fakeGoogle({ fcm: cannedAnswer(unavailable) });
  await assert.rejects(client(google, { sleep }).send(buildMessage(golden.recipient, EVENT)), {
    code: 'messaging/server-unavailable',
  });
  assert.equal(google.fcmCalls().length, 5);
  assert.deepEqual(delays, [0, 1000, 2000, 4000]);

  delays.length = 0;
  google = fakeGoogle({
    fcm: (_c, i) =>
      i === 0 ? json(503, JSON.parse(unavailable.response), { 'retry-after': '3' }) : sent(),
  });
  await client(google, { sleep }).send(buildMessage(golden.recipient, EVENT));
  assert.deepEqual(delays, [3000], 'Retry-After is honoured');

  delays.length = 0;
  google = fakeGoogle({
    fcm: () => json(503, JSON.parse(unavailable.response), { 'retry-after': '120' }),
  });
  await assert.rejects(client(google, { sleep }).send(buildMessage(golden.recipient, EVENT)), {
    code: 'messaging/server-unavailable',
  });
  assert.equal(google.fcmCalls().length, 1, 'a Retry-After over a minute is not waited for');

  google = fakeGoogle({ fcm: (_c, i) => (i < 2 ? cannedAnswer({ status: 0 })() : sent()) });
  await client(google, { sleep }).send(buildMessage(golden.recipient, EVENT));
  assert.equal(google.fcmCalls().length, 3, 'a dropped connection is retried');
});

test('a request that times out is transient: retried, then reported, and the token is kept', async () => {
  const hang = (call) =>
    new Promise((_resolve, reject) => {
      call.signal.addEventListener('abort', () => reject(call.signal.reason), { once: true });
    });
  const google = fakeGoogle({ fcm: hang });
  const sa = saFile();
  try {
    initPush({
      credsPath: sa.path,
      env: {},
      logger: recordingLogger(),
      messagingFactory: clientFactory(google, { timeoutMs: 20 }),
    });
    // The outbox sends it again later (#579).
    assert.deepEqual(await sendToToken(golden.recipient, EVENT), {
      ok: false,
      prune: false,
      retry: true,
      allPhones: true,
      error: 'app/network-timeout',
    });
    assert.equal(google.fcmCalls().length, 5);
  } finally {
    rmSync(sa.dir, { recursive: true, force: true });
  }

  // A token exchange with no answer is a network failure too, not a refused key,
  // and the log line before it says why.
  const slowToken = fakeGoogle({ token: hang });
  const logger = recordingLogger();
  await assert.rejects(
    client(slowToken, { timeoutMs: 20, logger }).send(buildMessage(golden.recipient, EVENT)),
    { code: 'app/network-timeout' }
  );
  assert.equal(slowToken.tokenCalls().length, 4, 'the exchange is retried 3 times');
  const [warn] = logger.lines.filter((l) => l.level === 'warn');
  assert.deepEqual(warn.args, [
    { status: 0, reason: 'Error while making request: timeout of 20ms exceeded.' },
    'fcm access token request failed',
  ]);
});

/** A fetch failure shaped as Node's fetch (undici) reports it: TypeError, the cause carrying the code. */
function undiciFailure(code, message = code) {
  return () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
  };
}

// The stalls firebase-admin's 15 s socket timeout turned into a retried ETIMEDOUT
// (a black-holed address, an answer that never starts or never ends), and a
// dropped connection, its ECONNRESET, as undici names them.
const STALLS = {
  UND_ERR_CONNECT_TIMEOUT: 'app/network-timeout',
  UND_ERR_HEADERS_TIMEOUT: 'app/network-timeout',
  UND_ERR_BODY_TIMEOUT: 'app/network-timeout',
  ETIMEDOUT: 'app/network-timeout',
  UND_ERR_SOCKET: 'app/network-error',
  ECONNRESET: 'app/network-error',
};

test('a connect, header or body timeout and a dropped connection are retried, on the send and on the token exchange', async (t) => {
  for (const [code, reported] of Object.entries(STALLS)) {
    await t.test(code, async () => {
      // Twice, then an answer: the send gets through.
      let google = fakeGoogle({ fcm: (call, i) => (i < 2 ? undiciFailure(code)() : sent()) });
      await client(google).send(buildMessage(golden.recipient, EVENT));
      assert.equal(google.fcmCalls().length, 3, 'send retried');
      google = fakeGoogle({ token: (call, i) => (i < 2 ? undiciFailure(code)() : tokenOk()) });
      await client(google).send(buildMessage(golden.recipient, EVENT));
      assert.equal(google.tokenCalls().length, 3, 'token exchange retried');

      // Every time: the send gives up after 4 retries, the exchange after 3.
      google = fakeGoogle({ fcm: undiciFailure(code) });
      await assert.rejects(client(google).send(buildMessage(golden.recipient, EVENT)), {
        code: reported,
      });
      assert.equal(google.fcmCalls().length, 5);
      google = fakeGoogle({ token: undiciFailure(code) });
      await assert.rejects(client(google).send(buildMessage(golden.recipient, EVENT)), {
        code: reported,
      });
      assert.equal(google.tokenCalls().length, 4);
    });
  }

  await t.test('a connect timeout behind happy eyeballs (AggregateError)', async () => {
    const aggregate = () => {
      const all = Object.assign(
        new AggregateError([
          Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
          Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH' }),
        ]),
        { code: undefined }
      );
      throw new TypeError('fetch failed', { cause: all });
    };
    const google = fakeGoogle({ fcm: (call, i) => (i < 1 ? aggregate() : sent()) });
    await client(google).send(buildMessage(golden.recipient, EVENT));
    assert.equal(google.fcmCalls().length, 2);
  });

  await t.test(
    'a refused connection or an unknown host is not retried, as firebase-admin did not',
    async () => {
      for (const code of ['ECONNREFUSED', 'ENOTFOUND']) {
        const google = fakeGoogle({
          token: undiciFailure(code, `getaddrinfo ${code} oauth2.googleapis.com`),
        });
        await assert.rejects(client(google).send(buildMessage(golden.recipient, EVENT)), {
          code: 'app/network-error',
        });
        assert.equal(google.tokenCalls().length, 1, code);
      }
    }
  );
});

test('every request has a timeout, follows no redirect, and goes only to the two Google hosts', async () => {
  const google = fakeGoogle({
    fcm: (_c, i) =>
      i === 0
        ? json(401, { error: { code: 401, message: 'x', status: 'UNAUTHENTICATED' } })
        : sent(),
  });
  // token_uri in the file is not where the key goes: the exchange URL is fixed.
  const c = createFcmHttpClient(serviceAccount({ token_uri: 'https://attacker.example/token' }), {
    fetch: google.fetch,
    sleep: async () => {},
    logger: recordingLogger(),
  });
  await c.send(buildMessage(golden.recipient, EVENT));
  assert.ok(google.calls.length >= 3);
  for (const call of google.calls) {
    assert.ok(call.signal instanceof AbortSignal, `${call.url} has a timeout`);
    assert.equal(call.redirect, 'error', `${call.url} follows no redirect`);
    assert.ok(
      ['https://oauth2.googleapis.com', 'https://fcm.googleapis.com'].includes(call.origin)
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

test('the service account is checked when push starts: one it cannot use leaves push off, with the reason', () => {
  const cases = [
    [{ project_id: undefined }, 'project_id'],
    [{ project_id: 'a/../b' }, 'project_id'],
    [{ client_email: '' }, 'client_email'],
    [{ private_key: undefined }, 'private_key'],
    [
      { private_key: '-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n' }, // pragma: allowlist secret
      'private_key',
    ],
    [
      {
        private_key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
          type: 'pkcs8',
          format: 'pem',
        }),
      },
      'private_key',
    ],
  ];
  for (const [overrides, field] of cases) {
    assert.throws(
      () => createFcmHttpClient(serviceAccount(overrides), { fetch: fakeGoogle().fetch }),
      (err) =>
        err instanceof FcmError &&
        err.code === 'app/invalid-credential' &&
        err.reason.includes(field),
      field
    );
  }
  assert.throws(() => createFcmHttpClient(null), { code: 'app/invalid-credential' });

  // Through initPush and its default factory: off, and the log says why.
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcmhttp-'));
  try {
    const path = join(dir, 'sa.json');
    writeFileSync(path, JSON.stringify(serviceAccount({ client_email: '' })));
    const logger = recordingLogger();
    initPush({ credsPath: path, env: {}, logger });
    assert.equal(isPushEnabled(), false);
    const warn = logger.lines.find((l) => l.level === 'warn');
    assert.equal(warn.args[0].reason, 'the service account has no client_email');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a usable service account turns push on at once: no boot race', () => {
  const sa = saFile();
  try {
    initPush({ credsPath: sa.path, env: {}, logger: recordingLogger() });
    assert.equal(isPushEnabled(), true);
  } finally {
    rmSync(sa.dir, { recursive: true, force: true });
  }
});

test('a service account written with camelCase keys works, as it did with firebase-admin', async () => {
  const google = fakeGoogle();
  const c = createFcmHttpClient(
    { projectId: golden.projectId, clientEmail: golden.clientEmail, privateKey: PEM },
    { fetch: google.fetch, sleep: async () => {}, logger: recordingLogger() }
  );
  await c.send(buildMessage(golden.recipient, EVENT));
  assert.equal(google.fcmCalls()[0].url, golden.request.url);
});

// ─────────────────────────────────────────────────────────────────────────────
// Secrets
// ─────────────────────────────────────────────────────────────────────────────

test('no secret reaches a log line, an error message or a thrown error', async () => {
  const ACCESS = 'SECRET-access-token-value-not-ya29-shaped';
  const logger = recordingLogger();
  const thrown = [];
  let assertion = null;
  const keep = (call) => {
    if (call.origin === 'https://oauth2.googleapis.com')
      assertion = new URLSearchParams(call.body).get('assertion');
  };
  const echo =
    (status, extra = '') =>
    (call) =>
      json(status, {
        error: {
          code: status,
          message: `${call.headers.get('authorization')} ${assertion} ${extra}`,
          status: 'INVALID_ARGUMENT',
        },
      });
  const scenarios = [
    // Google's error text echoing the assertion.
    fakeGoogle({
      token: (call) => {
        keep(call);
        return json(400, {
          error: 'invalid_grant',
          error_description: `bad ${new URLSearchParams(call.body).get('assertion')}`,
        });
      },
    }),
    // FCM's error text echoing the bearer and the assertion: a payload error (whose
    // message the log keeps), one naming the token, a 401 twice.
    fakeGoogle({
      token: (call) => {
        keep(call);
        return tokenOk(ACCESS);
      },
      fcm: echo(400),
    }),
    fakeGoogle({
      token: (call) => {
        keep(call);
        return tokenOk(ACCESS);
      },
      fcm: echo(400, 'registration token'),
    }),
    fakeGoogle({
      token: (call) => {
        keep(call);
        return tokenOk(ACCESS);
      },
      fcm: echo(401),
    }),
    // A transport error whose text carries the token.
    fakeGoogle({
      token: (call) => {
        keep(call);
        return tokenOk(ACCESS);
      },
      fcm: () => {
        throw new TypeError(`fetch failed ${ACCESS}`, {
          cause: Object.assign(new Error(ACCESS), { code: 'ECONNRESET' }),
        });
      },
    }),
    // A token answer that is not JSON, carrying the token.
    fakeGoogle({ token: () => new Response(`<html>${ACCESS}</html>`, { status: 500 }) }),
    // A token exchange that never gets an answer, its error text quoting the assertion.
    fakeGoogle({
      token: (call) => {
        keep(call);
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error(`stalled sending ${assertion}`), {
            code: 'UND_ERR_CONNECT_TIMEOUT',
          }),
        });
      },
    }),
  ];
  const sa = saFile();
  try {
    for (const google of scenarios) {
      initPush({
        credsPath: sa.path,
        env: {},
        logger,
        messagingFactory: (s) =>
          createFcmHttpClient(s, { fetch: google.fetch, sleep: async () => {}, logger }),
      });
      await sendToToken(golden.recipient, EVENT);
      const c = createFcmHttpClient(serviceAccount(), {
        fetch: google.fetch,
        sleep: async () => {},
        logger,
      });
      await c.send(buildMessage(golden.recipient, EVENT)).catch((err) => thrown.push(err));
    }
    // A key that does not parse, and one that is not RSA.
    for (const key of [
      PEM.slice(0, 400),
      generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    ]) {
      writeFileSync(sa.path, JSON.stringify(serviceAccount({ private_key: key })));
      initPush({ credsPath: sa.path, env: {}, logger });
      try {
        createFcmHttpClient(serviceAccount({ private_key: key }));
      } catch (err) {
        thrown.push(err);
      }
    }
  } finally {
    rmSync(sa.dir, { recursive: true, force: true });
  }

  assert.ok(assertion, 'an assertion was signed');
  assert.ok(thrown.length >= 6, 'errors were thrown');
  const keyLines = PEM.split('\n').filter((l) => l.length >= 40);
  const secrets = [ACCESS, assertion, assertion.split('.')[2], ...keyLines];
  const text = [
    ...logger.lines.map((l) => inspect(l.args, { depth: 10 }) + JSON.stringify(l.args)),
    ...thrown.map(
      (e) => `${e.message}\n${e.stack}\n${JSON.stringify(e)}\n${inspect(e, { depth: 10 })}`
    ),
  ].join('\n');
  for (const s of secrets) assert.ok(!text.includes(s), `a secret leaked: ${s.slice(0, 12)}…`);
});

// ─────────────────────────────────────────────────────────────────────────────

function saFile() {
  const dir = mkdtempSync(join(tmpdir(), 'jaghelm-fcmhttp-'));
  const path = join(dir, 'sa.json');
  writeFileSync(path, JSON.stringify(serviceAccount()));
  return { dir, path };
}

function clientFactory(google, opts = {}) {
  return (sa) =>
    createFcmHttpClient(sa, {
      fetch: google.fetch,
      sleep: async () => {},
      logger: recordingLogger(),
      ...opts,
    });
}
