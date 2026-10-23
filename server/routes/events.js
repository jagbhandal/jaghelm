/**
 * The alert history's endpoint (#267).
 *
 *   GET /api/events  → { events, next }: the events push's differ recorded in
 *                      the last 30 days (push/alertHistory.js), newest first,
 *                      whether or not push is set up. Each is { id, at, type,
 *                      severity, entity, title, body, reason, node, key,
 *                      push: { state, phones, suppressed } }.
 *
 * Query (each optional):
 *   limit     the most events in the page: 50 when not given, at most 200
 *   before    an event id: only older events (the previous page's `next`)
 *   entity    the status model's id (`services/vm103:immich`, `nodes/pve`):
 *             only events about it; repeat it for any of several
 *   severity  critical | warning | info, a comma list or repeated
 *
 * `next` is the id to pass as `before` for the page after, or null when there
 * is none. Ids only grow, so new events never move a page a client is reading:
 * they are on top of the first page. Behind the token like every /api read;
 * `no-store`, since a history is never reused.
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { EVENTS_PAGE_DEFAULT, EVENTS_PAGE_MAX, SEVERITIES } from '../push/alertHistory.js';

const WHOLE = /^[1-9]\d{0,15}$/;
const SEVERITY_SET = new Set(SEVERITIES);
/** The most entities one query may name. */
const MAX_ENTITIES = 50;

/** A query value as a list of strings, or null for anything else (an object from `entity[a]=b`). */
function strings(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.every((v) => typeof v === 'string') ? list : null;
}

/**
 * The page asked for, or { error } saying what can't be read.
 * @param {Record<string, unknown>} query
 */
export function readEventsQuery(query) {
  const page = { limit: EVENTS_PAGE_DEFAULT, before: null, entities: null, severities: null };

  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^\d{1,9}$/.test(query.limit) || Number(query.limit) < 1) {
      return { error: `limit must be a whole number from 1 (at most ${EVENTS_PAGE_MAX} are given)` };
    }
    page.limit = Math.min(Number(query.limit), EVENTS_PAGE_MAX);
  }

  if (query.before !== undefined) {
    if (typeof query.before !== 'string' || !WHOLE.test(query.before)) {
      return { error: "before must be an event id (a page's next)" };
    }
    page.before = Number(query.before);
  }

  if (query.entity !== undefined) {
    const list = strings(query.entity);
    if (!list || list.length > MAX_ENTITIES || list.some((v) => v === '' || v.length > 500)) {
      return { error: `entity must be an entity id, such as services/vm103:gitea (at most ${MAX_ENTITIES})` };
    }
    page.entities = new Set(list);
  }

  if (query.severity !== undefined) {
    const list = strings(query.severity)?.flatMap((v) => v.split(','));
    if (!list || list.some((v) => !SEVERITY_SET.has(v))) {
      return { error: 'severity must be critical, warning or info (a comma list for several)' };
    }
    page.severities = new Set(list);
  }

  return { page };
}

/**
 * @param {{ history: { events: (query: object) => { events: object[], next: string | null } } }} deps
 *   the push snapshot (push/dispatch.js createPushSnapshot), which keeps the history
 */
export function createEventsRoutes({ history }) {
  const router = Router();
  router.get('/', (req, res) => {
    const read = readEventsQuery(req.query);
    if (read.error) return apiError(res, 400, read.error);
    res.set('Cache-Control', 'no-store');
    return res.json(history.events(read.page));
  });
  return router;
}
