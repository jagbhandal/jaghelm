import React, { useState, useEffect, useRef, useCallback } from 'react';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import ConnectionScreen, { ConnectingScreen, ErrorScreen } from './ConnectionScreen.jsx';
import { bootMobile } from './boot.js';
import { forgetServer } from './auth/forgetServer.js';

const BOOTING = { phase: 'booting' };
const FAILED = { phase: 'failed' };

function fromBoot(initial) {
  if (initial.unreachable) return { phase: 'unreachable', baseUrl: initial.baseUrl };
  return { phase: 'ready', initial };
}

/**
 * Renders immediately and owns the boot attempt:
 *   booting     → "Connecting to JagHelm…"
 *   ready       → App (routes first-run / re-auth / the app from the boot result)
 *   unreachable → Can't reach JagHelm (Retry keeps the session; Change server
 *                 clears it and re-boots into first-run Login)
 *   failed      → Something went wrong (boot threw) + Retry
 * Every attempt takes a fresh id; a result only lands if its id is still the
 * current one. Starting a new attempt or unmounting supersedes the old one, so a
 * late result can never replace the screen the user is looking at.
 */
export default function Root() {
  const [state, setState] = useState(BOOTING);
  const attempt = useRef(0);

  const start = useCallback((task) => {
    const id = ++attempt.current;
    const isCurrent = () => id === attempt.current;
    setState(BOOTING);
    // The executor runs task() synchronously; a sync throw becomes a rejection,
    // and so does a malformed result that fromBoot can't read.
    new Promise((resolve) => resolve(task()))
      .then(fromBoot)
      .then(
        (next) => {
          if (isCurrent()) setState(next);
        },
        () => {
          if (isCurrent()) setState(FAILED);
        },
      );
  }, []);

  useEffect(() => {
    start(bootMobile);
    return () => {
      attempt.current += 1; // unmount (or StrictMode's dev re-mount) supersedes it
    };
  }, [start]);

  const retry = () => start(bootMobile);
  // Change server clears the session and address exactly as Forget this device
  // does (the same forgetServer), then re-boots into first-run.
  const changeServer = () =>
    start(async () => {
      await forgetServer();
      return bootMobile();
    });

  let screen;
  if (state.phase === 'ready') screen = <App initial={state.initial} />;
  else if (state.phase === 'unreachable')
    screen = <ConnectionScreen baseUrl={state.baseUrl} onRetry={retry} onChangeServer={changeServer} />;
  else if (state.phase === 'failed') screen = <ErrorScreen onRetry={retry} />;
  else screen = <ConnectingScreen />;

  return <ErrorBoundary>{screen}</ErrorBoundary>;
}
