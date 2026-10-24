/**
 * The utilities' data (#301, spec §8 item 5): what Quick Launch, Pipeline and
 * the Checklist (src/ui/utilities.jsx) show, for the Overview's rail and the
 * Launch page alike. No new server data: the config's links, /api/gitea/
 * activity and /api/todos, as the old board's panels read them.
 *
 *   linkGroups    Settings → Apps & links: every group with a link, in the config's
 *                 order (the old board drew only the first three); and
 *                 useLinkGroups, them from the config, and the link target
 *   pipelineRows  the newest commits across the repos, newest first, each
 *                 with its branch and CI result (#532)
 *   usePipeline   /api/gitea/activity, polled while on screen, and whether
 *                 a Gitea is set up (giteaConfigured)
 *   useTodos      /api/todos: one list for every view (todoStore); add, tick
 *                 and delete, each saving the list
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { appMonogram } from '@ui/side-nav';
import { useConfig } from '../context/ConfigContext.jsx';
import { useToast } from '../context/OverlayContext.jsx';
import { usePageVisible } from '../hooks/usePageVisible.js';
import { NOT_MODIFIED_NO_BODY, getGiteaActivity, getTodos, saveTodos } from '../hooks/useData.js';
import { safeUrl } from '../utils/safeUrl.js';
import { uuidV4 } from '../util/uuid.js';
import { formatLocalDate, isPastLocalDate } from '../util/localDate.js';
import { SLOW_EVERY, slowReadOf } from './tickBudget.js';

// Today's names for the three groups a fresh config starts with.
const GROUP_TITLES = {
  personal: 'Personal',
  management: 'Management',
  devops: 'Dev & Monitoring',
};

/** A group's key as Settings → Apps & links shows it: "home_lab" is "Home Lab". */
export const titleOf = (key) =>
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

/** The config's link groups (linkGroups), and where a link opens (Settings → Apps & links). */
export function useLinkGroups() {
  const { config } = useConfig();
  const groups = useMemo(() => linkGroups(config?.links), [config?.links]);
  return { groups, target: config?.linkTarget || '_blank' };
}

/** How many commits Pipeline lists. */
export const PIPELINE_ROWS = 6;

/**
 * Pipeline's rows from /api/gitea/activity's list ([{ repo, fullName, commits:
 * [{ sha, message, date, author, ref, ci }] }]): the newest `limit` commits
 * across the repos, each `{ id, title, repo, ref, sha, ci, at }`, `ref` the
 * branch, `ci` its CI result as the server judged it (`{ state, word }`, the
 * status rules' one table; StatusLamp reads a state it doesn't know as no
 * signal) or null without one: no lamp (#532), `at` in ms or null. Anything
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
        ref: commit.ref,
        sha: commit.sha,
        ci: commit.ci?.word ? commit.ci : null,
        at: Number.isFinite(at) ? at : null,
      });
    }
  }
  return rows.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity)).slice(0, limit);
}

/**
 * Whether `/api/gitea/activity` says a Gitea is set up (#272): true, false or
 * null (not known). `commits` is its last body (null before any), `source`
 * its read's health (`error`, and `lastSuccessMs`, null until a read
 * worked). The endpoint answers `{ configured: false }` when
 * JAGHELM_GITEA_URL is not set (nor its old name, GITEA_URL, still read); a
 * list is a Gitea that answered (an empty one too, once a read has worked);
 * and its 502 a Gitea that is set up and failing. Any other failure (JagHelm
 * unreachable, a timeout) says nothing.
 */
export function giteaConfigured(commits, source) {
  if (commits && typeof commits === 'object' && commits.configured === false) return false;
  if (Array.isArray(commits) && (commits.length > 0 || source?.lastSuccessMs != null)) return true;
  if (source?.error === 'HTTP 502') return true;
  return null;
}

/**
 * Pipeline refreshes once every PIPELINE_EVERY refresh intervals: commits
 * change slowly.
 */
export const PIPELINE_EVERY = SLOW_EVERY;

/**
 * /api/gitea/activity while `active` and the browser tab shows: at once, then
 * once every PIPELINE_EVERY refresh intervals, with the last ETag (an
 * unchanged answer is a 304 and no re-render). On the Overview, `tick` (the
 * App's refresh tick) times it: on the ticks tickBudget.js gives it, never
 * one that reads /api/history, so a tick stays within the request budget.
 * Without one (the Launch page), it keeps its own clock. `{ configured,
 * rows, failed }`: configured is true, false or null (not known yet), by
 * giteaConfigured; `failed` is the last read's error ("HTTP 502": a Gitea
 * that is set up and failing), null when it worked. The last rows stay
 * through a failure.
 */
export function usePipeline({ active = true, tick = null } = {}) {
  const { config } = useConfig();
  const visible = usePageVisible();
  const periodMs = (config?.refreshInterval || 30) * 1000 * PIPELINE_EVERY;
  const [read, setRead] = useState({ body: null, error: null, succeeded: false });
  const on = active && visible;
  const ticked = tick != null;
  // One read; `live` says whether its answer may still land.
  const load = useCallback(async (live) => {
    try {
      const body = await getGiteaActivity();
      if (!live()) return;
      setRead((was) => {
        const next = body == null || body === NOT_MODIFIED_NO_BODY ? was.body : body;
        return next === was.body && was.error == null && was.succeeded
          ? was
          : { body: next, error: null, succeeded: true };
      });
    } catch (err) {
      if (!live()) return;
      const error = err?.message || 'failed';
      setRead((was) => (was.error === error ? was : { ...was, error }));
    }
  }, []);
  // Mounted, for the answers of reads made on the tick.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Its own clock (the Launch page): at once, then every period.
  useEffect(() => {
    if (!on || ticked) return undefined;
    let cancelled = false;
    const live = () => !cancelled;
    load(live);
    const timer = setInterval(() => load(live), periodMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [on, ticked, periodMs, load]);
  // The App's tick (the Overview): at once when it comes on screen, then on
  // its ticks.
  const lastTick = useRef(null);
  useEffect(() => {
    if (!on || !ticked) {
      lastTick.current = null;
      return;
    }
    const first = lastTick.current === null;
    if (!first && tick === lastTick.current) return;
    lastTick.current = tick;
    if (first || slowReadOf(tick) === 'pipeline') load(() => mounted.current);
  }, [on, ticked, tick, load]);
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
 * The to-dos: one list for the whole page, held here, outside React. Every
 * view (the Overview's rail, the Launch page) reads it through
 * useSyncExternalStore and saves it from here, so none can save a stale copy
 * over another's change:
 * the endpoint replaces the whole list on each save (#301's review).
 *
 * `todos` is null until a read lands. Each view reads on mount (another
 * device may have changed it); a read's answer is dropped when this tab
 * changed the list since the read went out, or a save was still out then,
 * as the server may not have had it yet. A save that fails reads again, to
 * show what the server holds. When the last view goes (another page, a
 * sign-out), the list is forgotten.
 */
const todoStore = (() => {
  const EMPTY = { todos: null, failed: false };
  let state = EMPTY;
  let changes = 0;
  let saving = 0;
  const listeners = new Set();
  const set = (next) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const store = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          state = EMPTY;
          changes += 1;
        }
      };
    },
    async read() {
      const at = changes;
      const clean = saving === 0;
      try {
        const list = await getTodos();
        if (clean && at === changes) set({ todos: Array.isArray(list) ? list : [], failed: false });
      } catch {
        if (clean && at === changes) set({ ...state, failed: true });
      }
    },
    change(edit, onFailedSave) {
      if (state.todos == null) return;
      const next = edit(state.todos);
      changes += 1;
      saving += 1;
      set({ todos: next, failed: false });
      saveTodos(next).then(
        () => {
          saving -= 1;
        },
        () => {
          saving -= 1;
          onFailedSave();
          store.read();
        }
      );
    },
  };
  return store;
})();

/**
 * The to-do list (todoStore) and its three changes, each saving the whole
 * list. `todos` is null until the first read lands, so nothing is added to a
 * list that never came (a save would replace the server's with it); `failed`
 * says the read failed, `retry` reads again. A save that fails says so in a
 * toast, from the view that made the change (#236). A new to-do's id is
 * uuidV4's, which works on a plain-HTTP origin too.
 */
export function useTodos() {
  const toast = useToast();
  const { todos, failed } = useSyncExternalStore(todoStore.subscribe, todoStore.get);
  useEffect(() => {
    todoStore.read();
  }, []);
  const failedSave = useCallback(() => toast("Couldn't save the checklist", 'error'), [toast]);
  const add = useCallback(
    ({ text, due = null }) =>
      todoStore.change(
        (list) => [
          ...list,
          { id: uuidV4(), text, done: false, due, created: new Date().toISOString() },
        ],
        failedSave
      ),
    [failedSave]
  );
  const toggle = useCallback(
    (id) =>
      todoStore.change(
        (list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
        failedSave
      ),
    [failedSave]
  );
  const remove = useCallback(
    (id) => todoStore.change((list) => list.filter((t) => t.id !== id), failedSave),
    [failedSave]
  );

  const shown = useMemo(() => {
    if (todos == null) return null;
    const now = new Date();
    return todos.filter((t) => t && t.id != null).map((t) => shownTodo(t, now));
  }, [todos]);
  return { todos: shown, failed, retry: todoStore.read, add, toggle, remove };
}
