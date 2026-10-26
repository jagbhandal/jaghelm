/** #669: the alert rules as pure functions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CAUSES,
  LEGACY_TIMEZONE,
  causeFor,
  quietAt,
  resolveAlerts,
  sanitizeAlerts,
  summarize,
  systemTimezone,
  timezoneChoices,
  timezoneSource,
  validTimezone,
} from './alertRules.js';

test('an install with no alerts key reads the defaults: 60 s, quiet hours off, the server zone, the Omada cause', () => {
  for (const raw of [undefined, null, 5, 'x', []]) {
    const r = resolveAlerts(raw, 'Asia/Tokyo');
    assert.equal(r.groupWindowMs, 60_000);
    assert.equal(r.quiet.enabled, false);
    assert.equal(r.timezone, 'Asia/Tokyo');
    assert.deepEqual(r.causes, DEFAULT_CAUSES);
  }
  assert.equal(resolveAlerts(undefined).timezone, systemTimezone());
});

test('LIVE INSTALL (#703): alerts saved before the zone could be chosen keep America/Toronto', () => {
  // What a running install holds today: quiet hours set, no `timezone` key.
  const saved = { quietHours: { enabled: true, start: '22:00', end: '07:00' } };
  for (const raw of [saved, { groupWindowSeconds: 0 }, {}]) {
    assert.equal(resolveAlerts(raw, 'Asia/Tokyo').timezone, LEGACY_TIMEZONE);
    assert.equal(timezoneSource(raw), 'legacy');
  }
  // 23:00 Toronto (EDT) is 03:00 UTC: quiet in Toronto, not in the server's own zone.
  const at = Date.parse('2026-10-24T03:00:00Z');
  assert.equal(quietAt(resolveAlerts(saved, 'Asia/Tokyo'), at).quiet, true);
  assert.equal(quietAt(resolveAlerts(saved, 'Asia/Kolkata'), at).quiet, true);
  assert.equal(quietAt(resolveAlerts(saved, 'UTC'), at).quiet, true);
  assert.equal(timezoneSource(undefined), 'server');
  assert.equal(timezoneSource({ timezone: 'UTC' }), 'saved');
  assert.equal(resolveAlerts({ ...saved, timezone: 'Asia/Tokyo' }).timezone, 'Asia/Tokyo');
});

test('a time zone is valid only when it is on the IANA list or UTC', () => {
  for (const ok of ['UTC', 'America/Toronto', 'Europe/London', 'Asia/Kolkata']) {
    assert.equal(validTimezone(ok), true, ok);
  }
  for (const bad of [
    '',
    'Mars/Olympus',
    'toronto',
    'america/toronto',
    5,
    null,
    undefined,
    'x'.repeat(65),
    'Mars/Olympus',
    'Toronto',
    'GMT+5',
  ]) {
    assert.equal(validTimezone(bad), false, String(bad));
  }
  assert.ok(timezoneChoices().includes('UTC') && timezoneChoices().includes('America/Toronto'));
  assert.equal(validTimezone(systemTimezone()), true);
  assert.deepEqual(sanitizeAlerts({ timezone: 'Mars/Olympus' }), {});
  assert.deepEqual(sanitizeAlerts({ timezone: 'Europe/London' }), { timezone: 'Europe/London' });
});

test('sanitizeAlerts keeps the valid parts and drops the rest, never throwing', () => {
  assert.equal(sanitizeAlerts('x'), undefined);
  assert.deepEqual(
    sanitizeAlerts({
      groupWindowSeconds: 601,
      quietHours: { enabled: 'yes', start: '25:00', end: '06:30', mode: 'loud' },
      timezone: 'Mars/Olympus',
      knownCauses: [
        { match: ' ap ', label: ' reboot ' },
        { match: '', label: 'x' },
        7,
        { match: 'a'.repeat(81), label: 'x' },
      ],
      extra: 1,
    }),
    { quietHours: { end: '06:30' }, knownCauses: [{ match: 'ap', label: 'reboot' }] }
  );
  assert.deepEqual(sanitizeAlerts({ groupWindowSeconds: 0, knownCauses: [] }), {
    groupWindowSeconds: 0,
    knownCauses: [],
  });
  assert.equal(
    sanitizeAlerts({
      knownCauses: Array.from({ length: 30 }, (_, i) => ({ match: `m${i}`, label: 'l' })),
    }).knownCauses.length,
    20
  );
});

test('an explicit empty cause list means none, not the default', () => {
  assert.deepEqual(resolveAlerts({ knownCauses: [] }).causes, []);
});

const rules = (quiet) =>
  resolveAlerts({
    quietHours: { enabled: true, start: '22:00', end: '07:00', mode: 'critical', ...quiet },
  });

test('quiet hours run on Toronto time and cross midnight', () => {
  const r = rules();
  // 2026-10-24 is EDT (UTC-4).
  const at = (iso) => quietAt(r, Date.parse(iso));
  assert.deepEqual(at('2026-10-24T01:59:00Z'), { quiet: false }); // 21:59
  const night = at('2026-10-24T02:00:00Z'); // 22:00
  assert.equal(night.quiet, true);
  assert.equal(night.endsAt, Date.parse('2026-10-24T11:00:00Z')); // 07:00
  assert.equal(at('2026-10-24T10:59:30Z').endsAt, Date.parse('2026-10-24T11:00:00Z'));
  assert.deepEqual(at('2026-10-24T11:00:00Z'), { quiet: false });
  assert.equal(at('2026-10-24T08:00:00Z').quiet, true); // 04:00
});

test('quiet hours inside one day, off, and equal start and end', () => {
  const day = rules({ start: '09:00', end: '17:00' });
  assert.equal(quietAt(day, Date.parse('2026-10-24T16:00:00Z')).quiet, true); // noon
  assert.equal(quietAt(day, Date.parse('2026-10-24T03:00:00Z')).quiet, false);
  assert.equal(quietAt(rules({ enabled: false }), Date.parse('2026-10-24T03:00:00Z')).quiet, false);
  assert.equal(
    quietAt(rules({ start: '07:00', end: '07:00' }), Date.parse('2026-10-24T03:00:00Z')).quiet,
    false
  );
});

test('the time zone setting moves the hours', () => {
  const utc = resolveAlerts({
    timezone: 'UTC',
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
  });
  assert.equal(quietAt(utc, Date.parse('2026-10-24T23:00:00Z')).quiet, true);
  assert.equal(quietAt(utc, Date.parse('2026-10-24T16:00:00Z')).quiet, false);
});

test('a cause matches the service or host name in any case, the first rule wins, a test push never', () => {
  const causes = [
    { match: 'omada', label: 'AP upgrade' },
    { match: 'ap1', label: 'other' },
  ];
  assert.equal(
    causeFor({ type: 'service_down', id: 'x', body: 'Omada Controller on apps · down' }, causes),
    'AP upgrade'
  );
  assert.equal(causeFor({ type: 'service_down', id: 'n:omada', body: 'x' }, causes), 'AP upgrade');
  assert.equal(
    causeFor({ type: 'service_down', id: 'z', body: 'Jellyfin on nas · the ap gap' }, causes),
    null,
    'the reason is not searched'
  );
  assert.equal(causeFor({ type: 'push_test', id: 'omada', body: 'omada' }, causes), null);
  assert.equal(
    causeFor({ type: 'service_down', id: 'a', entity: 'services/omada:x', body: 'b' }, causes),
    'AP upgrade'
  );
});

test('summarize: counts, shared node, names and the worst severity', () => {
  const events = ['Eap1', 'Eap2', 'Eap3', 'Eap4', 'Eap5'].map((n) => ({
    type: 'service_down',
    id: n,
    body: `${n} on omada · timeout`,
    severity: n === 'Eap2' ? 'critical' : 'warning',
  }));
  const s = summarize(events, 'group', { tagOf: (e) => `services/${e.id}` });
  assert.equal(s.title, '5 services down on omada');
  assert.equal(s.body, 'Eap1, Eap2, Eap3 +2');
  assert.equal(s.severity, 'critical');
  assert.equal(s.members.length, 5);
  assert.ok(!JSON.stringify(s).includes('timeout'), 'no reason on a lock screen');
  const mixed = summarize(
    [events[0], { type: 'host_unreachable', id: 'h', body: 'pve', severity: 'critical' }],
    'digest',
    { tagOf: (e) => e.id }
  );
  assert.equal(mixed.title, 'While you were away: 2 alerts');
});
