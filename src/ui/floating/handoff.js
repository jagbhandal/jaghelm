/**
 * The layer's side of the hand-over from a light trigger (lib/floating.js,
 * useFloatingTrigger): once Base UI's trigger is in the page, it takes focus
 * back if the light one had it, and opens the popup if the light one was
 * activated (a click, Enter or Space, a Select's arrow) before the layer came.
 * `open` opens it through Base UI, as that click would have.
 */
import { useEffect, useLayoutEffect } from 'react';

export function useHandoff(handoff, triggerRef, open) {
  // Before paint, so focus never shows on <body>.
  useLayoutEffect(() => {
    if (!handoff?.focus) return;
    handoff.focus = false;
    const el = triggerRef.current;
    if (el && el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
    // Once, on the hand-over: later renders are Base UI's alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // After Base UI's own effects, which attach the handle the Root was given.
  useEffect(() => {
    if (!handoff?.open) return;
    handoff.open = false;
    open?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
