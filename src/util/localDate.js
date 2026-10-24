/**
 * Date-only values ("YYYY-MM-DD", as an <input type="date"> gives them) are
 * calendar days, not instants. `new Date('2026-10-20')` reads one as UTC
 * midnight, which is the evening of Oct 19 anywhere west of UTC, and
 * `toISOString().slice(0, 10)` names the UTC day, which is tomorrow there in the
 * evening. These helpers keep such values on the local calendar instead.
 */
import { formatDay } from './format.js';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight of a "YYYY-MM-DD" day, or null if it is not a real date-only value. */
export function parseLocalDate(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const date = new Date(2000, 0, 1);
  date.setFullYear(y, mo, d); // setFullYear: the Date constructor maps years 0-99 to 19xx
  // Reject days the calendar doesn't have (2026-02-30 would roll into March).
  if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
  return date;
}

/** The local calendar day of a Date as "YYYY-MM-DD" (today by default). */
export function localDateKey(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** True when a "YYYY-MM-DD" day is before today's local day; false on the day itself or if unparseable. */
export function isPastLocalDate(value, now = new Date()) {
  const date = parseLocalDate(value);
  return date !== null && localDateKey(date) < localDateKey(now);
}

/** A "YYYY-MM-DD" day for display, e.g. "Oct 20", or null if unparseable. */
export function formatLocalDate(value) {
  const date = parseLocalDate(value);
  return date ? formatDay(date) : null;
}
