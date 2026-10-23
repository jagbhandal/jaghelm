// @ts-check
/**
 * A job's schedule in words (#578), as the status model serves it on a job's
 * and a backup's entity (`schedule`, model.js), so every screen draws the same
 * words and none parses a cron expression of its own.
 */
import { spanText } from './rules.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CRON_FIELD = /^[\d*?/,-]+$/;
const DIGITS = /^\d+$/;
/** @param {string} n */
const pad = (n) => String(n).padStart(2, '0');
/** @param {string} field */
const any = (field) => field === '*' || field === '?';
/** A step field's size (15 for every 15), or null. @param {string} field */
const step = (field) => {
  const m = /^(?:\*|0)\/(\d+)$/.exec(field);
  return m ? Number(m[1]) : null;
};

/** 1st, 2nd, 3rd, 4th, 11th. @param {number} n */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * A five-field cron expression in words, or null for one these words don't cover.
 *
 * @param {string[]} fields  minute, hour, day of month, month, day of week
 */
function cronWords(fields) {
  const [min, hour, dom, mon, dow] = fields;
  if (!any(mon)) return null;
  if (any(hour) && any(dom) && any(dow)) {
    if (min === '*') return 'every minute';
    const n = step(min);
    if (n) return n === 1 ? 'every minute' : `every ${n} min`;
    if (DIGITS.test(min) && Number(min) < 60) return `hourly at :${pad(min)}`;
    return null;
  }
  if (!DIGITS.test(min) || Number(min) > 59) return null;
  const hours = step(hour);
  if (hours && any(dom) && any(dow)) {
    const every = hours === 1 ? 'hourly' : `every ${hours} h`;
    return Number(min) ? `${every} at :${pad(min)}` : every;
  }
  if (!DIGITS.test(hour) || Number(hour) > 23) return null;
  const time = `${pad(hour)}:${pad(min)}`;
  if (any(dom) && any(dow)) return `daily at ${time}`;
  if (any(dom) && /^[0-7]$/.test(dow)) return `weekly on ${DAYS[Number(dow) % 7]} at ${time}`;
  if (any(dom) && dow === '1-5') return `weekdays at ${time}`;
  if (DIGITS.test(dom) && Number(dom) >= 1 && Number(dom) <= 31 && any(dow))
    return `monthly on the ${ordinal(Number(dom))} at ${time}`;
  return null;
}

/**
 * A job's schedule in words. The reporter sends what it likes: words ("every
 * 15 min", "daily 3am") are shown as sent; a cron expression of five fields,
 * or six with seconds first (Ofelia's), is put in words where it is a common
 * one ("30 6 * * *" is "daily at 06:30"), a note after it in brackets kept
 * ("daily at 03:00 (Ofelia, America/Toronto)"), and shown as sent where it
 * isn't. With no schedule, the interval it is expected at ("every 24 h");
 * with neither, null.
 *
 * @param {unknown} schedule  the last run's `schedule`, as reported
 * @param {unknown} [everySeconds]  its `expected_every_seconds`
 */
export function scheduleWords(schedule, everySeconds) {
  const text = typeof schedule === 'string' ? schedule.trim() : '';
  if (text) {
    const [, expr, note] = /^(.*?)\s*(\([^()]*\))?$/.exec(text) ?? [];
    const fields = (expr ?? '').split(/\s+/);
    const cron = fields.every((f) => CRON_FIELD.test(f));
    const five =
      cron && fields.length === 5
        ? fields
        : cron && fields.length === 6 && DIGITS.test(fields[0])
          ? fields.slice(1)
          : null;
    const words = five && cronWords(five);
    if (words) return note ? `${words} ${note}` : words;
    return text;
  }
  return typeof everySeconds === 'number' && Number.isFinite(everySeconds) && everySeconds > 0
    ? `every ${spanText(everySeconds)}`
    : null;
}
