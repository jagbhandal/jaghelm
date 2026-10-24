import React from 'react';
import IframeView from './IframeView.jsx';

/**
 * AppFrames — hosts every mounted app frame (#269). `frames` is useAppFrames'
 * list: the open app shows, the others stay mounted, hidden, so each keeps its
 * page, scroll and sign-in. Hidden frames keep their full size (visibility,
 * not display: none), so an app laid out to its window, a terminal or a chart,
 * isn't squashed to nothing and redrawn on every switch.
 *
 * `savedTabs` is the tabs the server has saved (useConfigPersistence): the
 * embed check asks only about a frame whose URL the server has. A frame's
 * `reloads` (the app bar's Reload, #296) gives it a new iframe element.
 * `onEmbedAnyway(id, on)` saves a blocked app's "show it anyway" choice (#445).
 *
 * @param {{ frames: Array<{ tab: object, active: boolean, reloads?: number }>,
 *   savedTabs?: Array<object>, slowAfterMs?: number,
 *   onEmbedAnyway?: (id: string|number, on: boolean) => void }} props
 */
const host = { position: 'relative', flex: 1 };
// Nothing open: no height and nothing drawn, but each frame keeps its size.
const idleHost = { position: 'relative', height: 0, overflow: 'hidden' };
// Over the open app, its size, and clipped: a taller hidden frame (a notice
// with its how-to open) adds no scroll height. The frame inside keeps its own.
const hiddenSlot = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  overflow: 'hidden',
  visibility: 'hidden',
  pointerEvents: 'none',
};

/** The URL the server has saved for app tab `id`, if any. */
function savedUrlOf(savedTabs, id) {
  if (!Array.isArray(savedTabs)) return undefined;
  const t = savedTabs.find((s) => s && s.type === 'iframe' && String(s.id) === String(id));
  return typeof t?.url === 'string' ? t.url : undefined;
}

export default function AppFrames({ frames, savedTabs, slowAfterMs, onEmbedAnyway }) {
  const open = frames.some((f) => f.active);
  return (
    <div className="app-frames" style={open ? host : idleHost}>
      {frames.map(({ tab, active, reloads }) => (
        <div
          key={tab.id}
          style={active ? undefined : hiddenSlot}
          aria-hidden={active ? undefined : 'true'}
          inert={!active}
        >
          <IframeView
            tab={tab}
            savedUrl={savedUrlOf(savedTabs, tab.id)}
            slowAfterMs={slowAfterMs}
            reloads={reloads}
            onEmbedAnyway={onEmbedAnyway}
          />
        </div>
      ))}
    </div>
  );
}
