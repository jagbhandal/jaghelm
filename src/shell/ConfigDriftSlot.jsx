/**
 * Where the config drift row (#674) goes on a page: once the browser is idle
 * after the page draws, asks for ConfigDrift's chunk (lazyViews.js) and draws it
 * as soon as it is in, so the first screen never waits for it nor carries it
 * (scripts/first-load.mjs lists it with the idle chunks). A page that switched
 * the section off, or isn't showing the Overview, mounts nothing and loads
 * nothing. A chunk that won't load (an old tab after a deploy) or a section
 * that throws leaves the page without it, never with an error over the
 * Overview.
 */
import { useEffect, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { loadConfigDrift } from '../lazyViews.js';
import { useChunk } from './useChunk.js';
import { whenIdle } from './whenIdle.js';

// Once the page has been idle, later mounts (back on the Overview) draw it at once.
let idleSeen = false;

function Loaded(props) {
  const [ConfigDrift] = useChunk(loadConfigDrift);
  if (!ConfigDrift) return null;
  return (
    <ErrorBoundary inline itemId="configDrift" label="Config drift failed to render">
      <ConfigDrift {...props} />
    </ErrorBoundary>
  );
}

export function ConfigDriftSlot(props) {
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
