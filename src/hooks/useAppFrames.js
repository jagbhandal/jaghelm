/**
 * useAppFrames — which app frames are mounted (#269). An app tab (an `iframe`
 * tab in the config) mounts on its first visit and stays mounted while other
 * tabs are open, so switching back finds the app as it was left. Its tab
 * leaving the config unmounts it.
 *
 * Returns `[{ tab, active }]`: every mounted app, its tab, and whether it is
 * the open tab. A hidden frame keeps the URL it last showed: the URL field in
 * Settings changes the config on every key, and a frame that followed it would
 * load each partial URL. An edited URL loads when the tab is next opened; the
 * rest of the tab (its label) is the current one. The list is in first-visit
 * order, never config order: moving an iframe in the DOM reloads it, so
 * reordering the tabs must not move a frame. A mounted app that is not active
 * is "still loaded" (the sidebar's grey dot in #296).
 *
 * Logic only: AppFrames (src/views/AppFrames.jsx) is today's presentation, and
 * #296's sidebar can reuse this under its own.
 *
 * @param {Array<{ id: string, type?: string, url?: string }>} tabs every nav tab
 * @param {string} activeTab the open tab's id
 */
import { useState } from 'react';

export function useAppFrames(tabs, activeTab) {
  const apps = new Map();
  for (const t of tabs || []) if (t && t.type === 'iframe' && t.id != null) apps.set(t.id, t);

  // [{ id, url }]: each mounted frame and the URL it shows.
  const [mounted, setMounted] = useState(() =>
    apps.has(activeTab) ? [{ id: activeTab, url: apps.get(activeTab).url }] : []
  );

  // Adjust the state while rendering (React's pattern for state derived from
  // props): drop apps whose tab is gone, so a tab added back later mounts on
  // its next visit, not at once; add the newly opened app; give the open app
  // its current URL.
  let next = mounted.filter((m) => apps.has(m.id));
  if (apps.has(activeTab)) {
    const url = apps.get(activeTab).url;
    const i = next.findIndex((m) => m.id === activeTab);
    if (i === -1) next = [...next, { id: activeTab, url }];
    else if (next[i].url !== url) next = next.map((m, j) => (j === i ? { id: m.id, url } : m));
  }
  if (next.length !== mounted.length || next.some((m, i) => m !== mounted[i])) setMounted(next);

  return next.map(({ id, url }) => {
    const tab = apps.get(id);
    return { tab: tab.url === url ? tab : { ...tab, url }, active: id === activeTab };
  });
}
