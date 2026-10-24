/**
 * The alert history's endpoint (#267).
 *
 *   GET /api/events  → { events, next }: the events push's differ recorded in
 *                      the last 30 days (push/alertHistory.js), newest first,
 *                      whether or not push is set up. Each is { id, at, type,
 *                      severity, entity, title, body, reason, node, key,
 *                      push: { state, phones, suppressed } }, and `cause`, the
 *                      label of a known cause (#669) that matches its service
 *                      or host name, when one does.
 *
 * Query (each optional):
 *   limit     the most events in the page: 50 when not given, at most 200
 *   before    an event id: only older events (the previous page's `next`)
 *   entity    the status model's id (`services/vm103:immich`, `nodes/pve`):
 *             only events about it; repeat it for any of several
 *   severity  critical | warning | info, a comma list or repeated
 *   kind      the kind of entity (#314), the first part of its id: services,
 *             nodes, power, jobs, backups, integrations or sources; a comma
 *             list or repeated. An event of no entity has no kind.
 *   q         text to look for (#314), in any case, in the event's title,
 *             words, reason and entity id: 1 to 100 characters, once
 *
 * `next` is the id to pass as `before` for the page after, or null when there
 * is none. Ids only grow, so new events never move a page a client is reading:
 * they are on top of the first page. Behind the token like every /api read;
 * `no-store`, since a history is never reused.
 */
import { Router } from 'express';

import { apiError } from '../errors.js';
import { causeFor } from '../push/alertRules.js';
import {
  ENTITY_KINDS,
  EVENTS_PAGE_DEFAULT,
  EVENTS_PAGE_MAX,
  SEVERITIES,
} from '../push/alertHistory.js';

const WHOLE = /^[1-9]\d{0,15}$/;
const SEVERITY_SET = new Set(SEVERITIES);
const KIND_SET = new Set(ENTITY_KINDS);
/** The most entities one query may name. */
const MAX_ENTITIES = 50;
/** The longest text one query may look for. */
export const MAX_QUERY_TEXT = 100;

/** "a, b or c". */
const either = (list) => `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;

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
  const page = {
    limit: EVENTS_PAGE_DEFAULT,
    before: null,
    entities: null,
    kinds: null,
    severities: null,
    text: null,
  };

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

  if (query.kind !== undefined) {
    const list = strings(query.kind)?.flatMap((v) => v.split(','));
    if (!list || list.some((v) => !KIND_SET.has(v))) {
      return { error: `kind must be ${either(ENTITY_KINDS)} (a comma list for several)` };
    }
    page.kinds = new Set(list);
  }

  if (query.q !== undefined) {
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    if (text === '' || text.length > MAX_QUERY_TEXT) {
      return { error: `q must be some text to look for, at most ${MAX_QUERY_TEXT} characters` };
    }
    page.text = text;
  }

  return { page };
}

/**
 * @param {{ history: { events: (query: object) => { events: object[], next: string | null } }, causes?: () => ReadonlyArray<{ match: string, label: string }> }} deps
 *   the push snapshot (push/dispatch.js createPushSnapshot), which keeps the history;
 *   `causes`, the known causes now in force (#669): an event one matches carries `cause`
 */
export function createEventsRoutes({ history, causes = () => [] }) {
  const router = Router();
  router.get('/', (req, res) => {
    const read = readEventsQuery(req.query);
    if (read.error) return apiError(res, 400, read.error);
    res.set('Cache-Control', 'no-store');
    const page = history.events(read.page);
    // Known causes (#669) are the rules now in force, applied as the page is read,
    // so a cause added in Settings tags the alerts already in the history.
    const rules = causes();
    if (rules.length === 0) return res.json(page);
    const events = page.events.map((e) => {
      const cause = causeFor(e, rules);
      return cause ? { ...e, cause } : e;
    });
    return res.json({ ...page, events });
  });
  return router;
}
