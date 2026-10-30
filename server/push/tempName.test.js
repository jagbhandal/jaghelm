/**
 * A container running under a temporary name (#772): `<12 hex>_<name>`, what
 * an interrupted compose recreate leaves. The status model judges it (warn,
 * rules.js judgeContainer), the push snapshot records it (tempNames), the
 * differ pages it once and sends the recovery when the container runs under
 * its real name, and the alert history, Ack and Snooze treat it like any other
 * episode. Run through the real model and the real push cycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { alertKey, alertKind, categoryOf, shouldDeliver } from './dispatch.js';
import { entityOf } from './entity.js';
import { buildTempNames } from './snapshot.js';
import { cachesOf, pushPipeline } from '../testing/pushPipeline.js';
import { card, missing, node, NOW, UPS_ONLINE } from '../testing/statusFixtures.js';
import { judgeContainer, tempNameOf } from '../status/rules.js';

const TEMP = '0123456789ab_app';
const board = (...cards) =>
  cachesOf({
    services: {
      sources: { prometheus: { ok: true }, kuma: { ok: true } },
      nodes: { n1: node({}, { display_name: 'Node One', services: cards }) },
    },
    ups: UPS_ONLINE,
  });

test('tempNameOf: only 12 lowercase hex characters, an underscore, then a name', () => {
  assert.equal(tempNameOf('0123456789ab_app'), 'app');
  assert.equal(tempNameOf('0123456789ab_immich_redis'), 'immich_redis');
  for (const name of [
    'app',
    'immich_redis',
    '0123456789AB_app', // uppercase
    '0123456789a_app', // 11 characters
    '0123456789abc_app', // 13 characters
    '0123456789ab-app', // no underscore
    '0123456789ab_', // no name
    '0123456789gx_app', // not hex
    ' 0123456789ab_app',
    'x0123456789ab_app',
    '',
    null,
    undefined,
    42,
  ])
    assert.equal(tempNameOf(name), null, String(name));
});

test('judgeContainer: a temporary name warns and names the real container; a normal one is untouched', () => {
  const warn = judgeContainer({ card: card(`n1:${TEMP}`), containersRead: true });
  assert.equal(warn.state, 'warn');
  assert.equal(warn.word, 'Temporary name');
  assert.match(warn.reason, /temporary name/);
  assert.match(warn.reason, /real container is app$/);
  assert.deepEqual(judgeContainer({ card: card('n1:app'), containersRead: true }), {
    state: 'ok',
    word: 'Running',
    reason: 'Running',
  });
  // The container list unread is still no signal, not a warning.
  assert.equal(judgeContainer({ card: card(`n1:${TEMP}`), containersRead: false }).state, 'unknown');
});

test('a temporary name pages once, recovers under the real name, and shows on the Alerts page', async () => {
  const p = pushPipeline();
  try {
    await p.cycle(board(card('n1:app')));
    assert.deepEqual(p.sent, []);

    // The recreate is interrupted: the temporary container runs, the real one is gone.
    const status = await p.cycle(board(card(`n1:${TEMP}`), missing('n1:app', NOW - 60_000)));
    assert.deepEqual(
      status.issues.filter((e) => e.id === `services/n1:${TEMP}`).map((e) => [e.state, e.word]),
      [['warn', 'Temporary name']],
      'the Alerts page lists it'
    );
    assert.deepEqual(p.sent, [`service_temp_name n1:${TEMP}`]);
    const page = p.events[0];
    assert.equal(page.severity, 'warning');
    assert.match(page.body, /^app on n1 · Running under a temporary name/);
    assert.equal(entityOf(page), `services/n1:${TEMP}`);
    assert.deepEqual(p.snapshot.prev().tempNames, { [`n1:${TEMP}`]: 'warn' });

    // Still running as it is: no second page.
    await p.cycle(board(card(`n1:${TEMP}`), missing('n1:app', NOW - 60_000)));
    assert.equal(p.sent.length, 1);

    // It runs under its real name again.
    await p.cycle(board(card('n1:app')));
    assert.deepEqual(p.sent, [
      `service_temp_name n1:${TEMP}`,
      `service_temp_name_cleared n1:${TEMP}`,
    ]);
    const recovery = p.events[1];
    assert.equal(recovery.severity, 'info');
    assert.equal(entityOf(recovery), 'services/n1:app');
    assert.equal(p.snapshot.prev().tempNames?.[`n1:${TEMP}`], 'ok');

    // The next cycle forgets it and sends nothing.
    await p.cycle(board(card('n1:app')));
    assert.equal(p.sent.length, 2);
    assert.equal(p.snapshot.prev().tempNames, undefined);

    // The alert history has both, and Ack and Snooze share one key for them.
    const history = p.snapshot.events({}).events;
    assert.deepEqual(history.map((e) => e.type).sort(), ['service_temp_name', 'service_temp_name_cleared']);
    assert.equal(alertKey(page), alertKey(recovery));
    assert.equal(alertKind(page), 'page');
    assert.equal(alertKind(recovery), 'recovery');
  } finally {
    p.close();
  }
});

test('a temporary name is a service alert: its category and the recovery switch apply', () => {
  assert.equal(categoryOf('service_temp_name', 'n1:x'), 'service');
  const prefs = (extra) => ({
    enabled: true,
    notifyRecoveries: true,
    categories: { service: true, host: true, ups: true, cron: true, watchtower: true },
    ...extra,
  });
  const page = { type: 'service_temp_name', id: `n1:${TEMP}` };
  const recovery = { type: 'service_temp_name_cleared', id: `n1:${TEMP}` };
  assert.equal(shouldDeliver(page, prefs({})), true);
  assert.equal(shouldDeliver(page, prefs({ categories: { service: false } })), false);
  assert.equal(shouldDeliver(recovery, prefs({ notifyRecoveries: false })), false);
});

test('buildTempNames: holds while the real name is missing, drops when nothing is left, keeps through a Prometheus failure', () => {
  const entity = (id, kind, state, word) => ({ id, kind, state, word });
  const key = `n1:${TEMP}`;
  const prev = { [key]: 'warn' };
  const status = (...entities) => ({ entities });
  // The real name is a grey Missing card: still warn.
  assert.deepEqual(
    buildTempNames(status(entity('services/n1:app', 'container', 'warn', 'Missing')), prev),
    { [key]: 'warn' }
  );
  // No card of the real name at all: dropped, nothing sent.
  assert.deepEqual(buildTempNames(status(), prev), {});
  // A service of the real name that is up counts as running again.
  assert.deepEqual(
    buildTempNames(status(entity('services/n1:app', 'service', 'ok', 'Up')), prev),
    { [key]: 'ok' }
  );
  // Prometheus failing: what was held stays.
  assert.deepEqual(buildTempNames(status(), prev, false), { [key]: 'warn' });
  // An ok entry is dropped the cycle after.
  assert.deepEqual(buildTempNames(status(), { [key]: 'ok' }), {});
});
