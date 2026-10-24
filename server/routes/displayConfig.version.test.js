/**
 * #547: the display config saves only over the version a device read, as
 * services.yaml does (#423), with the same mechanism (util/fileVersion.js).
 *
 * POST /api/display-config replaced display-config.json with whatever a
 * device sent. A device open from before another's change posted its old
 * copy, so a section hidden elsewhere came back. Now GET answers the file's
 * version (an HMAC-SHA256 of its bytes with the per-install key) as a strong
 * ETag, and the POST must carry it back in If-Match: none is a 428, an old one
 * a 409 with the version now, and nothing is written either way. A missing
 * file's version takes the first save. The GET's ETag is that version, so a
 * poll's If-None-Match still gets a 304.
 *
 * These drive the real route against the real file.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';

const { displayConfigRoutes } = await import('./displayConfig.js');
const { stopBackgroundRefresh } = await import('../refresh.js');

after(() => stopBackgroundRefresh());

const DIR = process.env.JAGHELM_DATA_DIR;
const PATH = join(DIR, 'display-config.json');
const KEY_PATH = join(DIR, 'config-version.key');

const app = express();
app.disable('etag'); // as index.js: no ETag but the routes' own
app.use(express.json());
app.use('/api/display-config', displayConfigRoutes);

const read = (headers = {}) => request(app).get('/api/display-config').set(headers);
const write = (body, version) => {
  const r = request(app).post('/api/display-config');
  if (version !== undefined) r.set('If-Match', version);
  return r.send(body);
};

/** The file's version as the server makes it: an HMAC-SHA256 of its bytes, as an ETag. */
const fileVersion = () =>
  `"${createHmac('sha256', readFileSync(KEY_PATH)).update(readFileSync(PATH)).digest('base64url')}"`;
const fileText = () => readFileSync(PATH, 'utf8');
/** Put `config` on disk, as a hand edit or another device's save would. */
const onDisk = (config) => writeFileSync(PATH, JSON.stringify(config, null, 2));

const START = { refreshInterval: 30, theme: 'dark', overviewSections: { services: true } };

test("GET answers the file's version as a strong ETag, and a write must send exactly that", async () => {
  onDisk(START);
  const r = await read();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, START);
  assert.equal(r.headers.etag, fileVersion());
  assert.match(r.headers.etag, /^"[A-Za-z0-9_-]{43}"$/);

  const saved = await write({ ...START, theme: 'light' }, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(JSON.parse(fileText()).theme, 'light');
  // The answer is the new version, the one the next read answers.
  assert.equal(saved.headers.etag, fileVersion());
  assert.notEqual(saved.headers.etag, r.headers.etag);
  assert.equal((await read()).headers.etag, saved.headers.etag);
});

test("the version is the same key's HMAC as services.yaml's, so it survives a restart", async () => {
  onDisk(START);
  const key = readFileSync(KEY_PATH);
  assert.equal(key.length, 32);
  const want = `"${createHmac('sha256', key).update(fileText()).digest('base64url')}"`;
  assert.equal((await read()).headers.etag, want);
});

test('a poll with the ETag it holds gets a 304, and a 200 with the new ETag once the file changes', async () => {
  onDisk(START);
  const first = await read();
  const again = await read({ 'If-None-Match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.headers.etag, first.headers.etag);
  assert.equal(again.text, '');
  // A compressing proxy weakens the ETag on the way: still a 304.
  assert.equal((await read({ 'If-None-Match': `W/${first.headers.etag}` })).status, 304);

  onDisk({ ...START, theme: 'light' });
  const changed = await read({ 'If-None-Match': first.headers.etag });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.theme, 'light');
  assert.equal(changed.headers.etag, fileVersion());
});

test('a write without If-Match is refused (428) and the file is unchanged', async () => {
  onDisk(START);
  const before = fileText();
  const saved = await write({ ...START, theme: 'light' });
  assert.equal(saved.status, 428, saved.text);
  assert.match(saved.body.error, /If-Match/);
  assert.equal(fileText(), before);
});

test('a write over an older version is refused (409) with the version now, and the file is unchanged', async () => {
  onDisk(START);
  const deviceA = await read();
  const deviceB = await read();
  const hidden = { ...START, overviewSections: { services: false } };
  assert.equal((await write(hidden, deviceA.headers.etag)).status, 200);
  const after = fileText();

  const stale = await write({ ...START, theme: 'light' }, deviceB.headers.etag);
  assert.equal(stale.status, 409, stale.text);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers.etag, fileVersion(), 'the 409 names the version now');
  assert.equal(fileText(), after);
  assert.deepEqual(JSON.parse(fileText()).overviewSections, { services: false });
});

test('a version that is not one is refused (409): *, a made-up one, an empty one', async (t) => {
  for (const version of ['*', '"made-up"', '""']) {
    await t.test(version, async () => {
      onDisk(START);
      const before = fileText();
      const saved = await write({ ...START, theme: 'light' }, version);
      assert.equal(saved.status, 409, saved.text);
      assert.equal(fileText(), before);
    });
  }
});

test('a hand edit after the read makes the write 409', async () => {
  onDisk(START);
  const r = await read();
  onDisk({ ...START, refreshInterval: 60 });
  const saved = await write({ ...START, theme: 'light' }, r.headers.etag);
  assert.equal(saved.status, 409, saved.text);
  assert.equal(JSON.parse(fileText()).refreshInterval, 60);
});

test("a missing file's version accepts the first write, and only while it is missing", async () => {
  rmSync(PATH, { force: true });
  const r = await read();
  assert.equal(r.status, 200);
  assert.equal(r.body, null);
  assert.equal(r.headers.etag, '"absent"');

  const first = await write(START, r.headers.etag);
  assert.equal(first.status, 200, first.text);
  assert.ok(existsSync(PATH));
  assert.deepEqual(JSON.parse(fileText()), START);
  assert.equal(first.headers.etag, fileVersion());

  // Another device that read the missing file can't write over the new one.
  const late = await write({ theme: 'light' }, r.headers.etag);
  assert.equal(late.status, 409, late.text);
  assert.deepEqual(JSON.parse(fileText()), START);
});

test('an invalid body is still a 400 before the version is looked at, and nothing is written', async () => {
  onDisk(START);
  const before = fileText();
  const r = await write({ refreshInterval: 0 });
  assert.equal(r.status, 400);
  assert.equal(fileText(), before);
});

/**
 * The logger's lines written while `fn` runs, and its result. Anything else
 * on stdout or stderr (the test runner's own reports) passes through.
 */
async function logsOf(fn) {
  const lines = [];
  const originals = [process.stdout.write, process.stderr.write];
  const tap = (orig) =>
    function (chunk, ...rest) {
      const text = String(chunk);
      try {
        if (JSON.parse(text)?.module) {
          lines.push(text);
          return true;
        }
      } catch {
        // not one of ours
      }
      return orig.call(this, chunk, ...rest);
    };
  process.stdout.write = tap(originals[0]);
  process.stderr.write = tap(originals[1]);
  try {
    return { result: await fn(), lines };
  } finally {
    [process.stdout.write, process.stderr.write] = originals;
  }
}

/** Assert `r` (a read) has, and a save of it with the read's version heals the file. */
async function savesBack(r) {
  const saved = await write(r.body, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse(fileText()), r.body);
}

// The review's case (#547): one trailing comma typed by hand. The file used
// to read as null, a stale device rebased its one switch onto that and wrote
// a config without the rest.
test("a file that doesn't parse is a 503 with its version, never an empty config; a whole copy over that version rewrites it", async () => {
  const text = JSON.stringify(START, null, 2).replace(/\n}$/, ',\n}');
  writeFileSync(PATH, text);
  const r = await read();
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'config_unparseable');
  assert.match(r.body.error, /^display-config\.json doesn't parse \(/);
  assert.ok(!r.body.error.includes('dark'), 'the answer quotes the file');
  assert.equal(r.headers.etag, fileVersion(), 'the 503 carries the file version');
  // A poll holding an older ETag gets the 503 too, never a 304 over it.
  assert.equal((await read({ 'If-None-Match': r.headers.etag })).status, 503);

  const whole = { ...START, links: { Media: [{ name: 'Plex', url: 'https://plex.example/' }] } };
  const saved = await write(whole, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse(fileText()), whole);
});

test("a file that isn't a JSON object is a 503 the same way", async () => {
  for (const text of ['[1, 2]', 'null', '"text"']) {
    writeFileSync(PATH, text);
    const r = await read();
    assert.equal(r.status, 503, text);
    assert.equal(r.body.code, 'config_unparseable');
    assert.equal(r.headers.etag, fileVersion());
  }
});

test(
  "a file that can't be read is a 503 with no version, and a save is refused the same way",
  {
    skip: process.getuid?.() === 0,
  },
  async () => {
    onDisk(START);
    const version = fileVersion();
    chmodSync(PATH, 0o000);
    try {
      const r = await read();
      assert.equal(r.status, 503);
      assert.equal(r.body.code, 'config_unreadable');
      assert.match(r.body.error, /can't be read \(permission denied\)/);
      assert.equal(r.headers.etag, undefined);
      const saved = await write({ ...START, theme: 'light' }, version);
      assert.equal(saved.status, 503, saved.text);
      assert.equal(saved.body.code, 'config_unreadable');
    } finally {
      chmodSync(PATH, 0o644);
    }
    assert.deepEqual(JSON.parse(fileText()), START);
  }
);

test('a nested __proto__ is dropped from the read, and only it; a save of the read heals the file', async () => {
  writeFileSync(
    PATH,
    '{"theme":"dark","sections":{"ups":{"visible":true,"__proto__":{"polluted":true}},"pipeline":{"visible":false}}}'
  );
  const { result: r, lines } = await logsOf(() => read());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    theme: 'dark',
    sections: { ups: { visible: true }, pipeline: { visible: false } },
  });
  const warned = lines.filter((l) => l.includes('display-config.json has values'));
  assert.equal(warned.length, 1, lines.join(''));
  assert.match(warned[0], /sections\.ups\.__proto__/);
  assert.ok(!warned[0].includes('polluted'), 'the warning quotes the value');
  await savesBack(r);
});

test('a javascript: link is dropped, the other links stay; a save of the read heals the file', async () => {
  const EVIL = "javascript:fetch('/api/secrets')";
  onDisk({
    ...START,
    links: {
      Media: [
        { name: 'Plex', url: 'https://plex.example/' },
        { name: 'Evil', url: EVIL },
        { name: 'Jellyfin', url: 'https://jellyfin.example/' },
      ],
      Infra: [{ name: 'Proxmox', url: 'https://pve.example/' }],
    },
    tabs: [{ id: 'bad', label: 'Bad', type: 'iframe', url: 'data:text/html,hi' }],
  });
  const { result: r, lines } = await logsOf(() => read());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.links, {
    Media: [
      { name: 'Plex', url: 'https://plex.example/' },
      { name: 'Jellyfin', url: 'https://jellyfin.example/' },
    ],
    Infra: [{ name: 'Proxmox', url: 'https://pve.example/' }],
  });
  assert.deepEqual(r.body.tabs, []);
  assert.deepEqual(r.body.overviewSections, START.overviewSections);
  const warned = lines.filter((l) => l.includes('display-config.json has values')).join('');
  assert.match(warned, /links\.Media\[1\]/);
  assert.match(warned, /tabs\[0\]/);
  assert.ok(
    !warned.includes('javascript') && !warned.includes('data:'),
    'the warning quotes the value'
  );
  await savesBack(r);
});

test('one bad overviewSections entry is dropped, the map stays; one warning per version of the file', async () => {
  const SECRETISH = 'hand-typed-value-77';
  onDisk({
    ...START,
    overviewSections: { services: SECRETISH, rail: false, strip: true },
    refreshInterval: 'often',
  });
  const { result: r, lines } = await logsOf(async () => {
    const first = await read();
    await read();
    return first;
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { theme: 'dark', overviewSections: { rail: false, strip: true } });
  // The ETag is the version of the bytes on disk, bad values and all.
  assert.equal(r.headers.etag, fileVersion());
  const warned = lines.filter((l) => l.includes('display-config.json has values'));
  assert.equal(warned.length, 1, `one warning for the two reads: ${lines.join('')}`);
  assert.match(warned[0], /overviewSections\.services/);
  assert.match(warned[0], /refreshInterval/);
  assert.ok(!warned[0].includes(SECRETISH), 'the warning quotes the value');
  assert.ok(!warned[0].includes('often'), 'the warning quotes the value');
  await savesBack(r);
});

// #517: a custom group holds service uids now; one saved before holds bare
// container names, with an icon, a colour and the old board's hidden flag.
// Both read back as they are, with no warning (the client drops the dead keys
// and Settings rewrites the names), and either saves.
test('custom groups of the old shape and the new read back as stored, with no warning, and save', async () => {
  const OLD = {
    id: 'custom-1',
    title: 'DNS',
    icon: '🛡️',
    borderColor: '#7c5cff',
    hidden: true,
    containers: ['adguard-home'],
  };
  const NEW = {
    id: 'custom-2',
    title: 'Home',
    containers: ['pi-1:adguard-home', 'pi-1:Home Assistant'],
  };
  const both = {
    ...START,
    customGroups: [OLD, NEW],
    sections: { 'group-custom-1': { visible: false } },
  };
  onDisk(both);
  const { result: r, lines } = await logsOf(() => read());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, both);
  assert.deepEqual(
    lines.filter((l) => l.includes('display-config.json has values')),
    [],
    'no warning for either shape'
  );
  await savesBack(r);

  const migrated = {
    ...START,
    customGroups: [
      { id: 'custom-1', title: 'DNS', containers: ['pi-1:adguard-home', 'pi-2:adguard-home'] },
      NEW,
    ],
  };
  const saved = await write(migrated, (await read()).headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse(fileText()), migrated);
});

// ---- Custom themes (#331) ------------------------------------------------------

const MIDNIGHT = JSON.parse(
  readFileSync(new URL('../../docs/examples/midnight-theme.json', import.meta.url), 'utf8')
);
const BAD_THEME = { ...MIDNIGHT, tokens: { ...MIDNIGHT.tokens, 'text-2': 'oklch(0.52 0.02 255)' } };

test('a save of a theme that passes the contrast rules is written and read back as it was', async () => {
  onDisk(START);
  const r = await read();
  const saved = await write({ ...START, themes: [MIDNIGHT] }, r.headers.etag);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(JSON.parse(fileText()).themes, [MIDNIGHT]);
  assert.deepEqual((await read()).body.themes, [MIDNIGHT]);
});

test('a save that adds a theme failing the contrast rules is a 400 naming the pairing, and writes nothing', async () => {
  onDisk(START);
  const before = fileText();
  const r = await read();
  const refused = await write({ ...START, themes: [BAD_THEME] }, r.headers.etag);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /Theme "Midnight" was refused: .*text-2 on surface-1: \d\.\d\d:1, needs 4\.5:1/);
  assert.equal(fileText(), before);
});

test('a hand-edited bad theme is read as it is, and the config still saves, to remove it', async () => {
  onDisk({ ...START, themes: [BAD_THEME] });
  const r = await read();
  assert.deepEqual(r.body.themes, [BAD_THEME]);
  const kept = await write({ ...START, density: 'compact', themes: [BAD_THEME] }, r.headers.etag);
  assert.equal(kept.status, 200, kept.text);
  const again = await read();
  const removed = await write({ ...START, themes: [] }, again.headers.etag);
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(JSON.parse(fileText()).themes, []);
});

test('a theme with a hostile colour is a 400, however the config reached the server', async () => {
  onDisk(START);
  const r = await read();
  const evil = { ...MIDNIGHT, tokens: { ...MIDNIGHT.tokens, bg: 'red; background: url(https://x.example/a)' } };
  const refused = await write({ ...START, themes: [evil] }, r.headers.etag);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /bg is not a colour/);
});

// ---- Node order (#667) ---------------------------------------------------------

test('a saved nodeOrder round-trips; a hand-edited bad one never refuses the config and is not read as an order', async () => {
  onDisk(START);
  const r = await read();
  const saved = await write({ ...START, nodeOrder: ['pve', 'nas'] }, r.headers.etag);
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(fileText()).nodeOrder, ['pve', 'nas']);
  assert.deepEqual((await read()).body.nodeOrder, ['pve', 'nas']);

  onDisk({ ...START, nodeOrder: ['pve', 3] });
  const bad = await read();
  assert.equal(bad.status, 200);
  assert.equal(bad.body.nodeOrder, undefined);
  assert.equal(bad.body.theme, 'dark');
  // A device saves back what it read, so the bad value can't refuse the save.
  const again = await write({ ...bad.body, density: 'compact' }, bad.headers.etag);
  assert.equal(again.status, 200);
  assert.equal(JSON.parse(fileText()).nodeOrder, undefined);
});

// ---- Alert rules (#669) --------------------------------------------------------

test('alerts round-trips as its valid parts; a bad part never refuses the config and reads as unset', async () => {
  onDisk(START);
  const r = await read();
  const rules = {
    groupWindowSeconds: 120,
    quietHours: { enabled: true, start: '23:00', end: '06:30', mode: 'silent' },
    knownCauses: [{ match: 'omada', label: 'AP reboot' }],
  };
  assert.equal((await write({ ...START, alerts: rules }, r.headers.etag)).status, 200);
  assert.deepEqual(JSON.parse(fileText()).alerts, rules);
  assert.deepEqual((await read()).body.alerts, rules);

  // A hand edit: one bad window, one bad time, one bad cause.
  onDisk({
    ...START,
    alerts: {
      groupWindowSeconds: 99999,
      quietHours: { enabled: true, start: '9pm', end: '07:00' },
      knownCauses: [{ match: 'ok', label: 'fine' }, { match: '', label: 'x' }],
    },
  });
  const bad = await read();
  assert.equal(bad.status, 200);
  assert.deepEqual(bad.body.alerts, {
    quietHours: { enabled: true, end: '07:00' },
    knownCauses: [{ match: 'ok', label: 'fine' }],
  });
  const again = await write({ ...bad.body, density: 'compact' }, bad.headers.etag);
  assert.equal(again.status, 200);
  assert.equal(JSON.parse(fileText()).alerts.groupWindowSeconds, undefined);

  onDisk({ ...START, alerts: 'loud' });
  assert.equal((await read()).body.alerts, undefined);
});

test('a nodeOrder with one over-long key keeps the other keys; only that key is dropped (#667)', async () => {
  onDisk({ ...START, nodeOrder: ['pve', 'x'.repeat(65), 'nas'] });
  const r = await read();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.nodeOrder, ['pve', 'nas']);
  const saved = await write({ ...START, nodeOrder: ['pve', 'x'.repeat(65), 'nas'] }, r.headers.etag);
  assert.equal(saved.status, 200);
  assert.deepEqual((await read()).body.nodeOrder, ['pve', 'nas']);
});

// ---- Disk forecast lines (#670) ------------------------------------------------

test('saved disk forecast lines round-trip; a hand-edited bad pair never refuses the config and is not read', async () => {
  onDisk(START);
  const r = await read();
  const saved = await write({ ...START, diskForecastDays: { warn: 30, crit: 7 } }, r.headers.etag);
  assert.equal(saved.status, 200);
  assert.deepEqual((await read()).body.diskForecastDays, { warn: 30, crit: 7 });

  for (const bad of [{ warn: 3, crit: 14 }, { warn: 14 }, { warn: 'x', crit: 1 }, { warn: 14.5, crit: 3 }, 7]) {
    onDisk({ ...START, diskForecastDays: bad });
    const got = await read();
    assert.equal(got.status, 200);
    assert.equal(got.body.diskForecastDays, undefined, JSON.stringify(bad));
    const again = await write({ ...got.body, density: 'compact' }, got.headers.etag);
    assert.equal(again.status, 200);
  }
});

test('expiry targets and lines round-trip; a bad row, list or line is cleaned on save and left out on read, never refusing the config (#676)', async () => {
  onDisk(START);
  const r = await read();
  const saved = await write(
    {
      ...START,
      expiry: { tls: ['Nas.Example.com', 'https://bad/x', 'nas.example.com:443', 'git.lan:8443', 7] },
      expiryDays: { warn: 30, crit: 10 },
    },
    r.headers.etag
  );
  assert.equal(saved.status, 200);
  const got = await read();
  assert.deepEqual(got.body.expiry, { tls: ['nas.example.com', 'git.lan:8443'] }, 'canonical, once each, only what parses');
  assert.deepEqual(got.body.expiryDays, { warn: 30, crit: 10 });

  // A value of another shape reads as unset and never refuses the whole save.
  for (const bad of [
    { expiry: 'nas', expiryDays: { warn: 0, crit: 400 } },
    { expiry: { tls: 'nas' }, expiryDays: { warn: 'x', crit: 2.5 } },
    { expiry: [1, 2], expiryDays: { warn: 5, crit: 9 } },
    { expiry: { tls: Array.from({ length: 600 }, (_, i) => `h${i}.example.com`) } },
  ]) {
    onDisk({ ...START, ...bad });
    const back = await read();
    assert.equal(back.status, 200, JSON.stringify(bad).slice(0, 60));
    assert.equal(back.body.expiryDays, undefined, 'a pair that is no pair (crit not under warn) is left out');
    assert.equal(back.body.expiry, undefined);
    const again = await write({ ...back.body, density: 'compact' }, back.headers.etag);
    assert.equal(again.status, 200);
  }

  // Posting values of the wrong kind is not refused either; they are not stored.
  const fresh = await read();
  const odd = await write({ ...START, expiry: { tls: 'x' }, expiryDays: { warn: 3, crit: 3 } }, fresh.headers.etag);
  assert.equal(odd.status, 200);
  const stored = JSON.parse(readFileSync(PATH, 'utf8'));
  assert.equal(stored.expiry, undefined);
  assert.equal(stored.expiryDays, undefined, 'crit not under warn is not stored');

  // Too long a list is cut to 30 on read.
  onDisk({ ...START, expiry: { tls: Array.from({ length: 45 }, (_, i) => `h${i}.example.com`) } });
  assert.equal((await read()).body.expiry.tls.length, 30);
});
