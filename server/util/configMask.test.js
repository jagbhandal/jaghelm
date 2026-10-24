/**
 * #413: which values of services.yaml count as credentials, and how the
 * marker that stands in for one goes back to the stored value. The route
 * tests (routes/services.config.test.js) drive these through the real API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORED_MARKER,
  isStoredMarker,
  maskCredentials,
  restoreCredentials,
} from './configMask.js';

const STORED = { $stored: true };

test('the marker is { "$stored": true } and nothing else', () => {
  assert.deepEqual(STORED_MARKER, STORED);
  assert.ok(Object.isFrozen(STORED_MARKER));
  assert.ok(isStoredMarker({ $stored: true }));
  for (const v of [
    { $stored: true, x: 1 },
    { $stored: 'true' },
    { $stored: false },
    [true],
    '$stored',
    true,
    null,
  ]) {
    assert.ok(!isStoredMarker(v), JSON.stringify(v));
  }
});

test('a password or token is masked at any depth, whatever its value', () => {
  const cfg = {
    integrations: { a: { password: 'p', token: 12345 } }, // pragma: allowlist secret
    // A key older releases wrote, which nothing reads but GET still sends.
    custom_integrations: { old: { token: { nested: 'x' } } },
    nodes: { pi1: { token: '$secret:node_token' } }, // pragma: allowlist secret
  };
  assert.deepEqual(maskCredentials(cfg), {
    integrations: { a: { password: STORED, token: STORED } },
    custom_integrations: { old: { token: STORED } },
    nodes: { pi1: { token: STORED } },
  });
});

test('header values and a session login body are masked; names and the rest are not', () => {
  const cfg = {
    integrations: {
      x: {
        url: 'http://x.test',
        username: 'admin',
        authHeader: 'X-Api-Key',
        authPrefix: 'PVEAPIToken=',
        extraHeaders: { Authorization: 'Bearer abc', 'X-Empty': '' }, // pragma: allowlist secret
        session: { loginEndpoint: '/login', loginBody: 'user={username}&pass={password}' },
        fields: [{ key: 'token', label: 'Token', path: 'data.token' }],
      },
    },
  };
  assert.deepEqual(maskCredentials(cfg), {
    integrations: {
      x: {
        url: 'http://x.test',
        username: 'admin',
        authHeader: 'X-Api-Key',
        authPrefix: 'PVEAPIToken=',
        extraHeaders: { Authorization: STORED, 'X-Empty': '' },
        session: { loginEndpoint: '/login', loginBody: STORED },
        fields: [{ key: 'token', label: 'Token', path: 'data.token' }],
      },
    },
  });
});

test('a credential that is not set stays as it is', () => {
  const cfg = { integrations: { a: { password: '', token: null }, b: { url: 'http://b' } } };
  assert.deepEqual(maskCredentials(cfg), cfg);
});

test('masking copies: the input is not changed, and other values pass through', () => {
  const when = new Date('2026-10-20T00:00:00Z');
  const cfg = { integrations: { a: { password: 'p' } }, created: when }; // pragma: allowlist secret
  const masked = maskCredentials(cfg);
  assert.equal(cfg.integrations.a.password, 'p'); // pragma: allowlist secret
  assert.deepEqual(masked.created, when);
  assert.deepEqual(maskCredentials(null), null);
});

test('restore puts each stored value back in its marker\'s place', () => {
  const stored = {
    nodes: { pi1: { display_name: 'Pi' } },
    integrations: {
      a: { password: 'pa', extraHeaders: { Authorization: 'Bearer h' } }, // pragma: allowlist secret
      b: { token: '$secret:b_token', session: { loginBody: { pass: 'lb' } } }, // pragma: allowlist secret
    },
  };
  const posted = maskCredentials(stored);
  posted.nodes.pi1.display_name = 'Gateway';
  const r = restoreCredentials(posted, stored);
  assert.equal(r.ok, true);
  assert.deepEqual(r.config, {
    ...stored,
    nodes: { pi1: { display_name: 'Gateway' } },
  });
  // The restored values are copies: a later change to one can't reach the stored config.
  r.config.integrations.b.session.loginBody.pass = 'changed'; // pragma: allowlist secret
  assert.equal(stored.integrations.b.session.loginBody.pass, 'lb'); // pragma: allowlist secret
  // The posted body is left as it was.
  assert.deepEqual(posted.integrations.a.password, STORED);
});

test('restore refuses a marker with nothing stored in its place (409), naming only the path', () => {
  const stored = { integrations: { a: { password: 'secret-pa' }, b: {} } }; // pragma: allowlist secret
  const r = restoreCredentials({ integrations: { a: { password: STORED }, b: { password: STORED } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  // The route checks the version first (#423), so the file is as it was read:
  // the marker was put where the read put none, not left behind by a change.
  assert.equal(
    r.error,
    'No credential is stored at integrations.b.password for its marker to keep; send the credential itself, or leave it out'
  );
  assert.ok(!r.error.includes('secret-pa'));
});

test('restore refuses a marker anywhere a credential is not (400)', () => {
  const stored = { nodes: { pi1: { display_name: 'Pi' } } };
  const r = restoreCredentials({ nodes: { pi1: { display_name: STORED } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.match(r.error, /nodes\.pi1\.display_name/);
});

test('restore refuses an object with "$stored" that is not the marker (400)', () => {
  const stored = { integrations: { a: { password: 'p' } } }; // pragma: allowlist secret
  const r = restoreCredentials({ integrations: { a: { password: { $stored: true, v: 1 } } } }, stored);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('restore leaves a body without markers as it is', () => {
  const body = { nodes: {}, integrations: { a: { password: 'typed' } } }; // pragma: allowlist secret
  const r = restoreCredentials(body, { integrations: { a: { password: 'old' } } }); // pragma: allowlist secret
  assert.deepEqual(r, { ok: true, config: body });
});

test('a path the error names is cut to 200 characters', () => {
  const key = 'k'.repeat(500);
  const r = restoreCredentials({ integrations: { [key]: { password: STORED } } }, {});
  assert.equal(r.status, 409);
  assert.ok(r.error.length < 320, r.error.length);
});

test('a config nested thousands of levels deep is refused, not a crash', () => {
  const deep = (depth) => JSON.parse('{"x":'.repeat(depth) + '1' + '}'.repeat(depth));
  assert.deepEqual(restoreCredentials({ nodes: {}, deep: deep(20_000) }, {}), {
    ok: false,
    status: 400,
    error: 'Config is nested too deeply',
  });
  // As deep as a copy can go, the walk itself never overflows.
  const masked = maskCredentials({ deep: deep(1_500), integrations: { a: { token: 't' } } });
  assert.deepEqual(masked.integrations.a.token, STORED);
});

// ── Since the review: more places a credential can live ──────────────────

/** The masked value of `field` in an integration entry `entry`. */
function maskedField(entry, field, ctx) {
  return maskCredentials({ integrations: { x: entry } }, ctx).integrations.x[field];
}

test('every credential name is masked, whatever its case', () => {
  const names = [
    'apiKey', 'api_key', 'api-key', 'apikey', 'APIKEY', 'secret', 'client_secret',
    'pass', 'passwd', 'passphrase', 'access_token', 'auth_token', 'bearer', 'cookie',
    'Password', 'TOKEN',
  ];
  for (const name of names) {
    assert.deepEqual(maskedField({ url: 'http://x', [name]: 'v' }, name), STORED, name);
    // Not only in an integration entry.
    assert.deepEqual(maskCredentials({ nodes: { pi1: { [name]: 'v' } } }).nodes.pi1[name], STORED);
  }
  // Names of other things are not credentials.
  for (const name of ['auth', 'authHeader', 'authPrefix', 'queryParam', 'tokenPath', 'tokenHeader',
    'username', 'account_id', 'label', 'path']) {
    assert.equal(maskedField({ url: 'http://x', [name]: 'v' }, name), 'v', name);
  }
});

test('`key` is a credential only directly on an integration entry', () => {
  const cfg = {
    integrations: {
      x: {
        url: 'http://x',
        key: 'k-secret', // pragma: allowlist secret
        fields: [{ key: 'up', label: 'Up', path: 'a.up' }],
        extraEndpoints: [{ key: 'storage', endpoint: '/storage' }],
      },
      // An integration, node, service or header map named like a credential.
      key: { url: 'http://k' },
      secret: { url: 'http://s' },
      token: { url: 'http://t' },
    },
    custom_integrations: { old: { key: 'old-key' } },
    nodes: { cookie: { display_name: 'Cookie', key: 'not-an-entry' } },
    services: {
      pass: { monitor: 'Pass' },
      web: { monitor_per_node: { token: 'Web on token', secret: false } },
    },
    monitor_nodes: { token: 'pi1', password: 'pi2', 'Backups (key)': 'vm103' },
  };
  const masked = maskCredentials(cfg);
  assert.deepEqual(masked.integrations.x.key, STORED);
  assert.deepEqual(masked.integrations.x.fields, cfg.integrations.x.fields);
  assert.deepEqual(masked.integrations.x.extraEndpoints, cfg.integrations.x.extraEndpoints);
  for (const k of ['key', 'secret', 'token']) assert.deepEqual(masked.integrations[k], cfg.integrations[k]);
  assert.deepEqual(masked.custom_integrations.old.key, STORED);
  assert.deepEqual(masked.nodes, cfg.nodes);
  assert.deepEqual(masked.services, cfg.services);
  assert.deepEqual(masked.monitor_nodes, cfg.monitor_nodes, 'monitor names are names (#644)');
});

test('an endpoint that carries a key in its query or a password is masked whole', () => {
  const secretEndpoints = [
    '/status/sessions?X-Plex-Token=plex-secret', // pragma: allowlist secret
    '/api/stats?apikey=q-secret', // pragma: allowlist secret
    '/api/stats?a=1&api_key=q-secret', // pragma: allowlist secret
    '/api?token=t', // pragma: allowlist secret
    '//admin:pw@host/api', // pragma: allowlist secret
  ];
  for (const e of secretEndpoints) {
    assert.deepEqual(maskedField({ url: 'http://x', endpoint: e }, 'endpoint'), STORED, e);
    assert.deepEqual(maskedField({ url: 'http://x', testEndpoint: e }, 'testEndpoint'), STORED, e);
    const masked = maskCredentials({
      integrations: {
        x: {
          extraEndpoints: [{ key: 'more', endpoint: e }],
          session: { loginEndpoint: e },
        },
      },
    }).integrations.x;
    assert.deepEqual(masked.extraEndpoints[0].endpoint, STORED, e);
    assert.deepEqual(masked.session.loginEndpoint, STORED, e);
  }
  // A placeholder, or no key at all, is no credential in the endpoint itself.
  for (const e of ['/api/stats?apikey={token}', '/api/v1/summary', '/api?limit=10&sort=name']) {
    assert.equal(maskedField({ url: 'http://x', endpoint: e }, 'endpoint'), e, e);
  }
});

test('a key an endpoint fills in through a {placeholder} is masked, whatever its name', () => {
  const entry = {
    url: 'http://x',
    endpoint: '/sites/{site_code}/stats?user={username}',
    extraEndpoints: [{ key: 'more', endpoint: '/zones/{zone}' }],
    site_code: 'sc-secret', // pragma: allowlist secret
    zone: 'z-secret', // pragma: allowlist secret
    username: 'admin',
    other: 'plain',
  };
  const masked = maskCredentials({ integrations: { x: entry } }).integrations.x;
  assert.deepEqual(masked.site_code, STORED);
  assert.deepEqual(masked.zone, STORED);
  // The form shows the username and saves it back.
  assert.equal(masked.username, 'admin');
  assert.equal(masked.other, 'plain');
});

test("a preset's endpoint placeholders count too, but never a URL parameter the form shows", () => {
  const presets = {
    nextdns: { endpoint: '/profiles/{profile_id}/analytics/status' },
    cloudflare: { endpoint: '/client/v4/accounts/{account_id}/cfd_tunnel' },
  };
  const ctx = {
    presetOf: (key, entry) => presets[entry?.preset || key] || null,
    urlParamKeys: ['account_id'],
  };
  const cfg = {
    integrations: {
      nextdns: { url: 'https://api.nextdns.io', profile_id: 'p-secret', token: 't' }, // pragma: allowlist secret
      cf_two: { preset: 'cloudflare', url: 'https://api.cloudflare.com', account_id: 'acc' },
    },
  };
  const masked = maskCredentials(cfg, ctx).integrations;
  assert.deepEqual(masked.nextdns.profile_id, STORED);
  assert.equal(masked.cf_two.account_id, 'acc');
  // Without the presets the profile is just a value.
  assert.equal(maskCredentials(cfg).integrations.nextdns.profile_id, 'p-secret'); // pragma: allowlist secret
  // And a form-owned URL parameter is refused as a marker's place (400).
  const posted = maskCredentials(cfg, ctx);
  posted.integrations.cf_two.account_id = STORED;
  assert.equal(restoreCredentials(posted, cfg, ctx).status, 400);
  // The placeholder one round-trips.
  const back = restoreCredentials(maskCredentials(cfg, ctx), cfg, ctx);
  assert.deepEqual(back, { ok: true, config: cfg });
});

test('a loginBody is masked at any depth (a fallback session too)', () => {
  const entry = {
    url: 'http://pp',
    auth: 'session',
    session: { loginEndpoint: '/login', loginBody: { u: '{username}', p: '{password}' } },
    authFallback: 'alt',
    alt: { loginEndpoint: '/login2', loginBody: 'user=root&secret=fb-secret', tokenPath: 't' }, // pragma: allowlist secret
  };
  const masked = maskCredentials({ integrations: { x: entry } }).integrations.x;
  assert.deepEqual(masked.session.loginBody, STORED);
  assert.deepEqual(masked.alt.loginBody, STORED);
  assert.equal(masked.alt.loginEndpoint, '/login2');
  const back = restoreCredentials({ integrations: { x: masked } }, { integrations: { x: entry } });
  assert.deepEqual(back.config.integrations.x, entry);
});

test('in an array, a marker goes back to the element with the same name, id or key, never by position', () => {
  const stored = {
    custom_integrations: [
      { name: 'a', url: 'http://a', token: 'token-a' }, // pragma: allowlist secret
      { name: 'b', url: 'http://b', token: 'token-b' }, // pragma: allowlist secret
    ],
    integrations: {
      x: {
        url: 'http://x',
        extraEndpoints: [
          { key: 'one', endpoint: '/one?apikey=k1' }, // pragma: allowlist secret
          { key: 'two', endpoint: '/two?apikey=k2' }, // pragma: allowlist secret
        ],
      },
    },
  };
  const masked = maskCredentials(stored);

  // Reordered: each element keeps its own credential.
  const reordered = structuredClone(masked);
  reordered.custom_integrations.reverse();
  reordered.integrations.x.extraEndpoints.reverse();
  const r = restoreCredentials(reordered, stored);
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.custom_integrations.map((e) => [e.name, e.token]), [
    ['b', 'token-b'],
    ['a', 'token-a'],
  ]);
  assert.deepEqual(r.config.integrations.x.extraEndpoints.map((e) => [e.key, e.endpoint]), [
    ['two', '/two?apikey=k2'], // pragma: allowlist secret
    ['one', '/one?apikey=k1'], // pragma: allowlist secret
  ]);

  // The first element removed: b, now first, still gets b's.
  const shifted = { custom_integrations: [masked.custom_integrations[1]] };
  assert.equal(restoreCredentials(shifted, stored).config.custom_integrations[0].token, 'token-b');

  // Renamed: nothing stored under that name (409).
  const renamed = structuredClone(masked);
  renamed.custom_integrations[0].name = 'c';
  assert.equal(restoreCredentials(renamed, stored).status, 409);

  // No name, id or key: refused (400), as is a name two elements share.
  const anonymous = { custom_integrations: [{ url: 'http://a', token: STORED }] };
  const noId = restoreCredentials(anonymous, { custom_integrations: [{ url: 'http://a', token: 't' }] });
  assert.equal(noId.status, 400);
  assert.match(noId.error, /custom_integrations\.0\.token/);
  const twice = { custom_integrations: [masked.custom_integrations[1], masked.custom_integrations[1]] };
  assert.equal(restoreCredentials(twice, stored).status, 400);
  const storedTwice = { custom_integrations: [stored.custom_integrations[1], stored.custom_integrations[1]] };
  assert.equal(restoreCredentials(shifted, storedTwice).status, 400);
});

test("an integration's URL that carries a credential is masked whole, and kept by a save of the read (#422)", () => {
  for (const url of [
    'http://admin:pw@x:3000', // pragma: allowlist secret
    'http://t0k3n@x/api',
    'http://x/?apikey=k', // pragma: allowlist secret
    'http://x/api?a=1&token=t', // pragma: allowlist secret
    'http://x?key=k', // pragma: allowlist secret
  ]) {
    const cfg = { integrations: { x: { url, username: 'u' } }, custom_integrations: { old: { url } } };
    const masked = maskCredentials(cfg);
    assert.deepEqual(masked.integrations.x.url, STORED, url);
    assert.deepEqual(masked.custom_integrations.old.url, STORED, url);
    assert.equal(masked.integrations.x.username, 'u');
    const back = restoreCredentials(masked, cfg);
    assert.ok(back.ok, url);
    assert.deepEqual(back.ok && back.config, cfg, url);
  }
  // One with none is sent as it is, as the form shows and saves it.
  for (const url of ['http://x', 'https://x:8443/api?limit=10', 'http://x/a@b', 'http://x?key=']) {
    assert.equal(maskedField({ url }, 'url'), url, url);
  }
  // A marker for a URL with no credential stored is refused, as any marker
  // where the read puts none.
  const refused = restoreCredentials({ integrations: { x: { url: STORED } } }, { integrations: { x: { url: 'http://x' } } });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 400);
});
