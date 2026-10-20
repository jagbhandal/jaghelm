/**
 * useAppFrames — which app frames are mounted (#269, #296). An app tab (an
 * `iframe` tab in the config) mounts on its first visit and stays mounted
 * while other pages are open, so switching back finds the app as it was left.
 * It unmounts when its tab leaves the config, when it is unloaded (the
 * sidebar's Unload), or when more than MAX_LOADED_APPS are loaded and it is
 * the least recently opened: each loaded app is a whole web app running in
 * the page, and they add up.
 *
 * Returns `{ frames, unload, reload }`. `frames` is `[{ tab, active, reloads }]`:
 * every mounted app, its tab, whether it is the open page, and how many times
 * it was reloaded (`reload(id)`, the app bar's Reload: each one gives that app
 * a new iframe element, and no other app reloads). A hidden frame keeps the URL
 * it last showed: the URL field in Settings changes the config on every key,
 * and a frame that followed it would load each partial URL. An edited URL
 * loads when the app is next opened; the rest of the tab (its label) is the
 * current one. The list is in first-visit order, never config order or the
 * order of use: moving an iframe in the DOM reloads it, so neither reordering
 * the tabs nor opening an app may move a frame. A mounted app that is not
 * active is "still loaded" (the sidebar's dot). `unload(id)` unmounts a loaded
 * app that isn't open; the open one stays.
 *
 * Logic only: AppFrames (src/views/AppFrames.jsx) is today's presentation, and
 * the shell's sidebar (src/ui/side-nav.jsx) shows which apps are loaded.
 *
 * @param {Array<{ id: string, type?: string, url?: string }>} tabs every nav tab
 * @param {string | null} activeTab the open app's id, or anything else when no
 *   app is open
 */
import { useCallback, useState } from 'react';

/** How many apps stay loaded at once; opening one more unloads the least recently used. */
export const MAX_LOADED_APPS = 5;

export function useAppFrames(tabs, activeTab) {
  const apps = new Map();
  for (const t of tabs || []) if (t && t.type === 'iframe' && t.id != null) apps.set(t.id, t);

  // [{ id, url, used, reloads }]: each mounted frame, the URL it shows, when
  // it was last opened (a count that only goes up), and its reloads.
  const [mounted, setMounted] = useState(() =>
    apps.has(activeTab)
      ? [{ id: activeTab, url: apps.get(activeTab).url, used: 1, reloads: 0 }]
      : []
  );

  // Adjust the state while rendering (React's pattern for state derived from
  // props): drop apps whose tab is gone, so a tab added back later mounts on
  // its next visit, not at once; add the newly opened app, or mark it the most
  // recently used; give the open app its current URL; then unload the least
  // recently used past the cap, never the open one.
  let next = mounted.filter((m) => apps.has(m.id));
  if (apps.has(activeTab)) {
    const url = apps.get(activeTab).url;
    const i = next.findIndex((m) => m.id === activeTab);
    const latest = next.reduce((max, m) => (m.id === activeTab ? max : Math.max(max, m.used)), 0);
    if (i === -1) next = [...next, { id: activeTab, url, used: latest + 1, reloads: 0 }];
    else if (next[i].url !== url || next[i].used <= latest) {
      next = next.map((m, j) =>
        j === i ? { ...m, url, used: Math.max(m.used, latest + 1) } : m
      );
    }
  }
  while (next.length > MAX_LOADED_APPS) {
    const victim = next
      .filter((m) => m.id !== activeTab)
      .reduce((oldest, m) => (m.used < oldest.used ? m : oldest));
    next = next.filter((m) => m !== victim);
  }
  if (next.length !== mounted.length || next.some((m, i) => m !== mounted[i])) setMounted(next);

  const unload = useCallback(
    (id) => {
      if (id === activeTab) return;
      setMounted((list) => (list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : list));
    },
    [activeTab]
  );

  const reload = useCallback((id) => {
    setMounted((list) =>
      list.some((m) => m.id === id)
        ? list.map((m) => (m.id === id ? { ...m, reloads: m.reloads + 1 } : m))
        : list
    );
  }, []);

  const frames = next.map(({ id, url, reloads }) => {
    const tab = apps.get(id);
    return { tab: tab.url === url ? tab : { ...tab, url }, active: id === activeTab, reloads };
  });
  return { frames, unload, reload };
}
