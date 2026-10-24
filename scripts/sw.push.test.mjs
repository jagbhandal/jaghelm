// Web Push in the service worker (#653): the push and notificationclick handlers
// of public/sw.js, run in a vm context against a fake registration and clients.
// The caching tests are scripts/sw.test.mjs; this file also pins that a redirect
// to Cloudflare Access is never cached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { injectIntoSw } from './inject-sw-precache.mjs';

const SW_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'),
  'utf8'
);
const ORIGIN = 'https://dash.example.net';

/** A worker with a recording registration and a set of open windows. */
function loadWorker({ windows = [], network = null, cacheStore = null, subscription = null } = {}) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const closedLater = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    skipWaiting: async () => {},
    registration: {
      showNotification: async (title, options) => {
        shown.push({ title, options });
      },
      pushManager: { getSubscription: async () => subscription },
      getNotifications: async () => [{ close: () => closedLater.push(true) }],
    },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => {
        opened.push(url);
      },
    },
  };
  const stored = [];
  const caches = cacheStore ?? {
    open: async () => ({ put: async (request) => stored.push(request.url), addAll: async () => {} }),
    keys: async () => [],
    match: async () => undefined,
  };
  vm.runInNewContext(
    injectIntoSw(SW_SOURCE, ['/assets/index-NEW.js'], '9.9.9', ['/assets/index-NEW.js']),
    { self, caches, fetch: network ?? (async () => new Response('x')), URL, Request, Date, JSON, setTimeout: (fn) => fn() },
    { filename: 'sw.js' }
  );
  const run = async (type, event) => {
    const pending = [];
    listeners[type]({ ...event, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };
  return { run, shown, opened, listeners, stored, closedLater };
}

const pushOf = (payload) => ({ data: { json: () => (typeof payload === 'function' ? payload() : payload) } });

const critical = {
  v: 1,
  title: 'Service down',
  body: 'Jellyfin on apps',
  tag: 'services/apps:jellyfin',
  url: '/?entity=services/apps:jellyfin',
  severity: 'critical',
  type: 'service_down',
};

test('push shows one notification: the title, the body, the tag, the icon, and the link in data', async () => {
  const w = loadWorker();
  await w.run('push', pushOf(critical));
  assert.equal(w.shown.length, 1);
  const { title, options } = w.shown[0];
  assert.equal(title, 'Service down');
  assert.equal(options.body, 'Jellyfin on apps');
  assert.equal(options.tag, 'services/apps:jellyfin');
  assert.equal(options.renotify, true, 'a repeat under the same tag still alerts');
  assert.equal(options.icon, '/icon-192.png');
  assert.equal(options.requireInteraction, true);
  assert.deepEqual({ ...options.data }, { url: '/?entity=services/apps:jellyfin' });
});

test('push replaces by tag: two events for one thing carry the same tag', async () => {
  const w = loadWorker();
  await w.run('push', pushOf(critical));
  await w.run('push', pushOf({ ...critical, title: 'Service recovered', severity: 'info' }));
  assert.equal(w.shown[0].options.tag, w.shown[1].options.tag);
  assert.equal(w.shown[1].options.requireInteraction, false);
});

test('push ALWAYS shows a notification, whatever arrives: no data, junk, a throwing parser, an array', async () => {
  for (const event of [
    {},
    { data: null },
    { data: { json: () => { throw new SyntaxError('bad'); } } },
    pushOf('a string'),
    pushOf(null),
    pushOf([1, 2]),
    pushOf({}),
  ]) {
    const w = loadWorker();
    await w.run('push', event);
    assert.equal(w.shown.length, 1, JSON.stringify(event));
    assert.ok(w.shown[0].title.length > 0);
  }
  const w = loadWorker();
  await w.run('push', {});
  assert.equal(w.shown[0].title, 'JagHelm');
  assert.match(w.shown[0].options.body, /Open JagHelm/);
});

test('push bounds the copy and drops a tag that is not text', async () => {
  const w = loadWorker();
  await w.run('push', pushOf({ ...critical, title: 'T'.repeat(1000), body: 'B'.repeat(1000), tag: 5 }));
  assert.ok(w.shown[0].title.length <= 120);
  assert.ok(w.shown[0].options.body.length <= 200);
  assert.equal('tag' in w.shown[0].options, false);
});

test('push keeps only a same-origin relative path as the link', async () => {
  for (const url of [
    'https://evil.example/',
    '//evil.example/x',
    '/\\evil.example',
    'javascript:alert(1)',
    'data:text/html,x',
    'evil',
    '',
    null,
    5,
    '/a\nb',
    `/${'a'.repeat(3000)}`,
  ]) {
    const w = loadWorker();
    await w.run('push', pushOf({ ...critical, url }));
    assert.equal(w.shown[0].options.data.url, '/', String(url).slice(0, 40));
  }
  const w = loadWorker();
  await w.run('push', pushOf({ ...critical, url: '/alerts?entity=nodes/pi-1#top' }));
  assert.equal(w.shown[0].options.data.url, '/alerts?entity=nodes/pi-1#top');
});

function click(w, data) {
  const closed = [];
  return w
    .run('notificationclick', { notification: { data, close: () => closed.push(true) } })
    .then(() => closed);
}

test('notificationclick closes the notification and opens a window when none is open', async () => {
  const w = loadWorker({ windows: [] });
  const closed = await click(w, { url: '/?entity=nodes/pi-1' });
  assert.equal(closed.length, 1);
  assert.deepEqual(w.opened, ['/?entity=nodes/pi-1']);
});

test('notificationclick focuses the open dashboard window and takes it to the alert', async () => {
  const calls = [];
  const win = {
    url: `${ORIGIN}/services`,
    focus: async () => {
      calls.push('focus');
      return win;
    },
    navigate: async (url) => {
      calls.push(`navigate ${url}`);
      return win;
    },
  };
  const other = { url: 'https://other.example/', focus: async () => calls.push('WRONG'), navigate: async () => calls.push('WRONG') };
  const w = loadWorker({ windows: [other, win] });
  await click(w, { url: '/?entity=services/apps:jellyfin' });
  assert.deepEqual(calls, ['focus', 'navigate /?entity=services/apps:jellyfin']);
  assert.deepEqual(w.opened, []);
});

test('notificationclick opens a window when the open one will not navigate', async () => {
  const win = { url: `${ORIGIN}/`, focus: async () => win, navigate: async () => { throw new TypeError('not controlled'); } };
  const w = loadWorker({ windows: [win] });
  await click(w, { url: '/alerts' });
  assert.deepEqual(w.opened, ['/alerts']);
});

test('notificationclick never leaves the origin, whatever the notification’s data holds', async () => {
  for (const data of [{ url: 'https://evil.example/' }, { url: '//evil.example' }, {}, null, undefined, { url: 5 }]) {
    const w = loadWorker({ windows: [] });
    await click(w, data);
    assert.deepEqual(w.opened, ['/']);
  }
});

// Cloudflare Access (#653): an expired session redirects to another origin.
test('the worker never caches an Access redirect: opaque, followed to another origin, or a 3xx', async () => {
  // A Response whose read-only fields (type, url, redirected) say what the test needs.
  const made = (props) => {
    const r = new Response('body', { status: 200 });
    for (const [k, v] of Object.entries(props)) Object.defineProperty(r, k, { value: v });
    return r;
  };
  const answers = {
    '/opaque': () => made({ type: 'opaqueredirect' }),
    '/followed': () => made({ redirected: true, url: 'https://team.cloudflareaccess.com/login' }),
    '/elsewhere': () => made({ url: 'https://team.cloudflareaccess.com/login' }),
    '/own': () => made({ url: `${ORIGIN}/own` }),
  };
  const network = async (request) => answers[new URL(request.url).pathname]();
  for (const [path, cached] of [['/opaque', false], ['/followed', false], ['/elsewhere', false], ['/own', true]]) {
    const w = loadWorker({ network });
    let responded;
    await w.run('fetch', {
      request: { url: `${ORIGIN}${path}`, method: 'GET', mode: 'navigate' },
      respondWith: (p) => {
        responded = p;
      },
    });
    await responded;
    await new Promise((r) => setImmediate(r));
    assert.equal(w.stored.some((u) => u.endsWith(path)), cached, path);
  }
});

test('the worker still leaves /api/ requests to the network, never cached or answered', async () => {
  const w = loadWorker();
  let responded = false;
  await w.run('fetch', {
    request: { url: `${ORIGIN}/api/auth/check`, method: 'GET', mode: 'cors' },
    respondWith: () => {
      responded = true;
    },
  });
  assert.equal(responded, false);
  assert.deepEqual(w.stored, []);
});

// pushsubscriptionchange (#653): subscribe again with the old key, nothing else.
test('pushsubscriptionchange subscribes again with the old subscription’s key, userVisibleOnly', async () => {
  const subscribed = [];
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    registration: { pushManager: { subscribe: async (o) => subscribed.push(o) } },
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(
    injectIntoSw(SW_SOURCE, [], '9.9.9', []),
    { self, caches: { open: async () => ({}), keys: async () => [] }, fetch: async () => new Response('x'), URL, Request, Date, JSON },
    { filename: 'sw.js' }
  );
  const key = new Uint8Array([4, 1, 2, 3]).buffer;
  const run = async (event) => {
    const pending = [];
    listeners.pushsubscriptionchange({ ...event, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };
  await run({ oldSubscription: { options: { applicationServerKey: key } } });
  assert.equal(subscribed.length, 1);
  assert.equal(subscribed[0].userVisibleOnly, true);
  assert.equal(subscribed[0].applicationServerKey, key);
  // the browser made a new one already: nothing to do
  await run({ oldSubscription: { options: { applicationServerKey: key } }, newSubscription: {} });
  assert.equal(subscribed.length, 1);
  // no old key (some browsers send none): nothing to subscribe with, and no throw
  await run({ oldSubscription: null });
  await run({});
  assert.equal(subscribed.length, 1);
  // a subscribe the browser refuses does not break the event
  self.registration.pushManager.subscribe = async () => {
    throw new Error('https://fcm.googleapis.com/fcm/send/LEAK');
  };
  await run({ oldSubscription: { options: { applicationServerKey: key } } });
});

// Snooze and Ack from the notification (#669).
const actionable = { ...critical, keys: ['services/apps:jellyfin'], actions: true };

test('a page that can be silenced offers Snooze 1h and Ack, and carries its keys; a recovery and a test push offer neither', async () => {
  const w = loadWorker();
  await w.run('push', pushOf(actionable));
  const { options } = w.shown[0];
  assert.deepEqual(JSON.parse(JSON.stringify(options.actions.map((a) => [a.action, a.title]))), [
    ['snooze', 'Snooze 1h'],
    ['ack', 'Ack'],
  ]);
  assert.deepEqual([...options.data.keys], ['services/apps:jellyfin']);
  for (const payload of [
    { ...actionable, actions: false },
    { ...actionable, keys: [] },
    { ...actionable, keys: 'nope' },
    critical,
  ]) {
    const x = loadWorker();
    await x.run('push', pushOf(payload));
    assert.equal('actions' in x.shown[0].options, false);
    assert.equal('keys' in x.shown[0].options.data, false);
  }
});

function clickAction(w, action, data) {
  return w.run('notificationclick', { action, notification: { tag: 'services/apps:jellyfin', data, close() {} } });
}

test('Ack posts the browser’s subscription endpoint and the keys, and says so; nothing opens', async () => {
  const posts = [];
  const w = loadWorker({
    subscription: { endpoint: 'https://push.example/endpoint-1' },
    network: async (url, init) => {
      posts.push({ url, init });
      return new Response('{}', { status: 200 });
    },
  });
  await clickAction(w, 'ack', { url: '/', keys: ['services/apps:jellyfin'] });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/push/web/alert-action');
  assert.deepEqual(JSON.parse(posts[0].init.body), {
    endpoint: 'https://push.example/endpoint-1',
    action: 'ack',
    keys: ['services/apps:jellyfin'],
  });
  assert.equal(w.shown[0].title, 'Acknowledged');
  assert.equal(w.shown[0].options.silent, true);
  assert.deepEqual(w.opened, []);
  assert.equal(w.closedLater.length, 1, 'the confirmation closes itself');
});

test('Snooze asks for an hour; a failed post says so and opens nothing by itself', async () => {
  const bodies = [];
  const ok = loadWorker({
    subscription: { endpoint: 'https://push.example/e' },
    network: async (url, init) => (bodies.push(JSON.parse(init.body)), new Response('{}', { status: 200 })),
  });
  await clickAction(ok, 'snooze', { keys: ['k'] });
  assert.equal(bodies[0].minutes, 60);
  assert.equal(ok.shown[0].title, 'Snoozed for 1 hour');

  for (const w of [
    loadWorker({ subscription: { endpoint: 'https://push.example/e' }, network: async () => new Response('no', { status: 500 }) }),
    loadWorker({ subscription: { endpoint: 'https://push.example/e' }, network: async () => { throw new TypeError('offline'); } }),
    loadWorker({ subscription: null }),
  ]) {
    await clickAction(w, 'ack', { keys: ['k'] });
    assert.equal(w.shown[0].title, 'Could not reach JagHelm');
    assert.equal(w.opened.length, 0);
  }
});

test('an action with no keys in the notification falls back to a plain tap', async () => {
  const w = loadWorker({ windows: [] });
  await clickAction(w, 'ack', { url: '/alerts' });
  assert.deepEqual(w.opened, ['/alerts']);
});
