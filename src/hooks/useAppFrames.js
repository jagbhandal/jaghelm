/**
 * useAppFrames — which app frames are mounted (#269). An app tab (an `iframe`
 * tab in the config) mounts on its first visit and stays mounted while other
 * tabs are open, so switching back finds the app as it was left. Its tab
 * leaving the config unmounts it.
 *
 * Returns `[{ tab, active }]`: every mounted app, its current tab object (an
 * edited URL reaches the frame) and whether it is the open tab. The list is in
 * first-visit order, never config order: moving an iframe in the DOM reloads
 * it, so reordering the tabs must not move a frame. A mounted app that is not
 * active is "still loaded" (the sidebar's grey dot in #296).
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

  const [visited, setVisited] = useState(() => (apps.has(activeTab) ? [activeTab] : []));

  // Adjust the state while rendering (React's pattern for state derived from
  // props): add the newly opened app, drop apps whose tab is gone so a tab added
  // back later mounts on its next visit, not at once.
  const kept = visited.filter((id) => apps.has(id));
  const next = apps.has(activeTab) && !kept.includes(activeTab) ? [...kept, activeTab] : kept;
  if (next.length !== visited.length || next.some((id, i) => id !== visited[i])) setVisited(next);

  return next.map((id) => ({ tab: apps.get(id), active: id === activeTab }));
}
