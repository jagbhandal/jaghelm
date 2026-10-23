/**
 * A job's schedule in words (#578): the reporter's words as sent, a common
 * cron expression put in words, else the interval it is expected at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scheduleWords } from './schedule.js';

test('puts the common cron expressions in words, five fields or six with seconds first', () => {
  assert.equal(scheduleWords('30 6 * * *'), 'daily at 06:30');
  assert.equal(scheduleWords('0 3 * * *'), 'daily at 03:00');
  assert.equal(scheduleWords('*/15 * * * *'), 'every 15 min');
  assert.equal(scheduleWords('* * * * *'), 'every minute');
  assert.equal(scheduleWords('5 * * * *'), 'hourly at :05');
  assert.equal(scheduleWords('0 */6 * * *'), 'every 6 h');
  assert.equal(scheduleWords('15 */2 * * *'), 'every 2 h at :15');
  assert.equal(scheduleWords('0 4 * * 0'), 'weekly on Sun at 04:00');
  assert.equal(scheduleWords('0 4 * * 7'), 'weekly on Sun at 04:00');
  assert.equal(scheduleWords('30 22 * * 1-5'), 'weekdays at 22:30');
  assert.equal(scheduleWords('0 2 1 * *'), 'monthly on the 1st at 02:00');
  assert.equal(scheduleWords('0 2 22 * *'), 'monthly on the 22nd at 02:00');
  assert.equal(scheduleWords('0 2 13 * *'), 'monthly on the 13th at 02:00');
  // Ofelia's six fields, a note after it kept.
  assert.equal(
    scheduleWords('0 0 3 * * * (Ofelia, America/Toronto)'),
    'daily at 03:00 (Ofelia, America/Toronto)'
  );
});

test('shows words, and an expression it has no words for, as the reporter sent them', () => {
  assert.equal(scheduleWords('every 15 min'), 'every 15 min');
  assert.equal(scheduleWords('daily 3am'), 'daily 3am');
  assert.equal(scheduleWords('every 10 min while MS-S1 is on'), 'every 10 min while MS-S1 is on');
  assert.equal(scheduleWords('*/5 9-17 * * 1-5'), '*/5 9-17 * * 1-5');
  assert.equal(scheduleWords('0 3 * 1 *'), '0 3 * 1 *');
  assert.equal(scheduleWords('  weekly  '), 'weekly');
});

test('with no schedule, the interval it is expected at; with neither, none', () => {
  assert.equal(scheduleWords(undefined, 86_400), 'every 24 h');
  assert.equal(scheduleWords('', 900), 'every 15 min');
  assert.equal(scheduleWords(undefined, undefined), null);
  assert.equal(scheduleWords(null, 0), null);
});
