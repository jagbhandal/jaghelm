/**
 * The utilities' data (#301, spec §8 item 5): what Quick Launch, Pipeline and
 * the Checklist (src/ui/utilities.jsx) show, for the Overview's rail and the
 * Launch page alike. No new server data: the config's links, /api/gitea/
 * activity and /api/todos, as today's board panels read them.
 *
 *   linkGroups    Settings → Links: every group with a link, in the config's
 *                 order (today's board drew only the first three); and
 *                 useLinkGroups, them from the config, and the link target
 *   pipelineRows  the newest commits across the repos, newest first
 *   usePipeline   /api/gitea/activity, polled while on screen, and whether
 *                 a Gitea is set up (configuredPanels.js's rule)
 *   useTodos      /api/todos: add, tick and delete, each saving the list
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appMonogram } from '@ui/side-nav';
import { useConfig } from '../context/ConfigContext.jsx';
import { useToast } from '../context/OverlayContext.jsx';
import { usePageVisible } from '../hooks/usePageVisible.js';
import { NOT_MODIFIED_NO_BODY, getGiteaActivity, getTodos, saveTodos } from '../hooks/useData.js';
import { safeUrl } from '../utils/safeUrl.js';
import { uuidV4 } from '../util/uuid.js';
import { formatLocalDate, isPastLocalDate } from '../util/localDate.js';
import { giteaConfigured } from '../views/DashboardView/configuredPanels.js';

// Today's names for the three groups a fresh config starts with.
const GROUP_TITLES = {
  personal: 'Personal',
  management: 'Management',
  devops: 'Dev & Monitoring',
};

/** A group's key as Settings → Links shows it: "home_lab" is "Home Lab". */
const titleOf = (key) =>
  String(key)
    .replace(/_/g, ' ')
    .replace(/(^|\s)(\S)/g, (_, space, letter) => space + letter.toUpperCase());

/**
 * The Quick Launch groups from the config's `links` ({ group: [{ name, url,
 * icon }] }): every group with a link, in the config's order, each link with
 * its address (safeUrl: one that isn't http, https or mailto is left out, as
 * it can't be opened) and its monogram. A group with no link left is left out.
 */
export function linkGroups(links) {
  if (!links || typeof links !== 'object' || Array.isArray(links)) return [];
  return Object.entries(links)
    .map(([key, list]) => ({
      key,
      title: GROUP_TITLES[key] ?? titleOf(key),
      links: (Array.isArray(list) ? list : []).flatMap((link, i) => {
        const href = safeUrl(link?.url);
        if (!href) return [];
        const name = String(link.name || '').trim() || href.replace(/^https?:\/\//, '');
        return [{ id: `${i}:${href}`, name, href, monogram: appMonogram(name) }];
      }),
    }))
    .filter((group) => group.links.length > 0);
}

/** The config's link groups (linkGroups), and where a link opens (Settings → Layout). */
export function useLinkGroups() {
  const { config } = useConfig();
  const groups = useMemo(() => linkGroups(config?.links), [config?.links]);
  return { groups, target: config?.linkTarget || '_blank' };
}

/** How many commits Pipeline lists. */
export const PIPELINE_ROWS = 6;

/**
 * Pipeline's rows from /api/gitea/activity's list ([{ repo, fullName, commits:
 * [{ sha, message, date, author }] }]): the newest `limit` commits across the
 * repos, each `{ id, title, repo, sha, at }`, `at` in ms or null. Anything
 * else (`{ configured: false }`, nothing yet) is no rows.
 */
export function pipelineRows(activity, limit = PIPELINE_ROWS) {
  if (!Array.isArray(activity)) return [];
  const rows = [];
  for (const group of activity) {
    if (!group || !Array.isArray(group.commits)) continue;
    for (const commit of group.commits) {
      if (!commit) continue;
      const at = Date.parse(commit.date ?? '');
      rows.push({
        id: `${group.fullName ?? group.repo}@${commit.sha}#${rows.length}`,
        title: commit.message || commit.sha,
        repo: group.repo,
        sha: commit.sha,
        at: Number.isFinite(at) ? at : null,
      });
    }
  }
  return rows.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity)).slice(0, limit);
}

/**
 * Pipeline refreshes every third refresh interval, as today's board polls its
 * slow sources (useDashboardData's SLOW_SOURCES): commits change slowly.
 */
export const PIPELINE_EVERY = 3;

/**
 * /api/gitea/activity while `active` and the browser tab shows: at once, then
 * every PIPELINE_EVERY refresh intervals, with the last ETag (an unchanged
 * answer is a 304 and no re-render). `{ configured, rows, failed }`:
 * configured is true, false or null (not known yet), by configuredPanels.js's
 * rule; `failed` is the last read's error ("HTTP 502": a Gitea that is set up
 * and failing), null when it worked. The last rows stay through a failure.
 */
export function usePipeline({ active = true } = {}) {
  const { config } = useConfig();
  const visible = usePageVisible();
  const periodMs = (config?.refreshInterval || 30) * 1000 * PIPELINE_EVERY;
  const [read, setRead] = useState({ body: null, error: null, succeeded: false });
  const on = active && visible;
  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const body = await getGiteaActivity();
        if (cancelled) return;
        setRead((was) => {
          const next = body == null || body === NOT_MODIFIED_NO_BODY ? was.body : body;
          return next === was.body && was.error == null && was.succeeded
            ? was
            : { body: next, error: null, succeeded: true };
        });
      } catch (err) {
        if (cancelled) return;
        const error = err?.message || 'failed';
        setRead((was) => (was.error === error ? was : { ...was, error }));
      }
    };
    load();
    const timer = setInterval(load, periodMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [on, periodMs]);
  return useMemo(
    () => ({
      configured: giteaConfigured(read.body, {
        error: read.error,
        lastSuccessMs: read.succeeded ? 0 : null,
      }),
      rows: pipelineRows(read.body),
      failed: read.error,
    }),
    [read]
  );
}

/** A to-do as the Checklist draws it: its due day as words, and whether it has passed. */
function shownTodo(todo, now) {
  return {
    ...todo,
    dueLabel: todo.due ? (formatLocalDate(todo.due) ?? String(todo.due)) : null,
    overdue: !todo.done && isPastLocalDate(todo.due, now),
  };
}

/**
 * /api/todos, read once on mount (and on `retry`), and the three changes,
 * each saving the whole list (the endpoint replaces it). `todos` is null
 * until the first read lands, so nothing is added to a list that never came
 * (a save would replace the server's with it); `failed` says the read
 * failed. A save that fails says so in a toast and reads the list again, to
 * show what the server holds rather than the change that didn't save (#236).
 * A new to-do's id is uuidV4's, which works on a plain-HTTP origin too.
 */
export function useTodos() {
  const toast = useToast();
  const [todos, setTodos] = useState(null);
  const [failed, setFailed] = useState(false);
  const current = useRef(todos);
  current.current = todos;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const list = await getTodos();
      if (!alive.current) return;
      setTodos(Array.isArray(list) ? list : []);
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    (change) => {
      if (current.current == null) return;
      const next = change(current.current);
      current.current = next;
      setTodos(next);
      saveTodos(next).catch(() => {
        toast("Couldn't save the checklist", 'error');
        load();
      });
    },
    [toast, load]
  );
  const add = useCallback(
    ({ text, due = null }) =>
      save((list) => [
        ...list,
        { id: uuidV4(), text, done: false, due, created: new Date().toISOString() },
      ]),
    [save]
  );
  const toggle = useCallback(
    (id) => save((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),
    [save]
  );
  const remove = useCallback((id) => save((list) => list.filter((t) => t.id !== id)), [save]);

  const shown = useMemo(() => {
    if (todos == null) return null;
    const now = new Date();
    return todos.filter((t) => t && t.id != null).map((t) => shownTodo(t, now));
  }, [todos]);
  return { todos: shown, failed, retry: load, add, toggle, remove };
}
