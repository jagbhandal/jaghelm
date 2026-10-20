import React from 'react';
import IframeView from './IframeView.jsx';

/**
 * AppFrames — hosts every mounted app frame (#269). `frames` is useAppFrames'
 * list: the open app shows, the others stay mounted, hidden, so each keeps its
 * page, scroll and sign-in. Hidden frames keep their full size (visibility,
 * not display: none), so an app laid out to its window, a terminal or a chart,
 * isn't squashed to nothing and redrawn on every switch.
 *
 * @param {{ frames: Array<{ tab: object, active: boolean }>, slowAfterMs?: number }} props
 */
const host = { position: 'relative', flex: 1 };
// Nothing open: no height and nothing drawn, but each frame keeps its size.
const idleHost = { position: 'relative', height: 0, overflow: 'hidden' };
const hiddenSlot = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
};

export default function AppFrames({ frames, slowAfterMs }) {
  const open = frames.some((f) => f.active);
  return (
    <div className="app-frames" style={open ? host : idleHost}>
      {frames.map(({ tab, active }) => (
        <div
          key={tab.id}
          style={active ? undefined : hiddenSlot}
          aria-hidden={active ? undefined : 'true'}
          inert={!active}
        >
          <IframeView tab={tab} slowAfterMs={slowAfterMs} />
        </div>
      ))}
    </div>
  );
}
