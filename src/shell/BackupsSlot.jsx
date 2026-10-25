/**
 * Where the Backups section (#675) goes on a page: once the browser is idle
 * after the page draws, asks for Backups' chunk (lazyViews.js) and draws it
 * as soon as it is in, so the first screen never waits for it nor carries it
 * (scripts/first-load.mjs lists it with the idle chunks). A page that switched
 * the section off, or isn't showing the Overview, mounts nothing and loads
 * nothing. A chunk that won't load (an old tab after a deploy) or a section
 * that throws leaves the page without it, never with an error over the
 * Overview.
 */
import { useEffect, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { loadBackups } from '../lazyViews.js';
import { useChunk } from './useChunk.js';
import { whenIdle } from './whenIdle.js';

// Once the page has been idle, later mounts (back on the Overview) draw it at once.
let idleSeen = false;

function Loaded(props) {
  const [Backups] = useChunk(loadBackups);
  if (!Backups) return null;
  return (
    <ErrorBoundary inline itemId="backupFreshness" label="Backups failed to render">
      <Backups {...props} />
    </ErrorBoundary>
  );
}

export function BackupsSlot(props) {
  const [idle, setIdle] = useState(idleSeen);
  useEffect(() => {
    if (idle) return undefined;
    return whenIdle(() => {
      idleSeen = true;
      setIdle(true);
    });
  }, [idle]);
  return idle ? <Loaded {...props} /> : null;
}
