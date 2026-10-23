/**
 * The phone screens' navigation on the web (#303): the shared nav stack
 * (src/phone/nav/useNavStack.js, the one the Android app drives), its root
 * the open tab, and each detail pushed on it a history entry of its own. So
 * the browser's Back closes the detail on top, as the phone's back button
 * does, Forward opens it again, and a reload with a detail open draws it
 * again: the entry holds the details it shows (`history.state`, under
 * SHEETS), never a URL of their own (entity URLs are Phase 2's, #309).
 *
 * A detail's own Back goes back in the history, so the two can't disagree.
 * When a detail closes, focus returns to what opened it (a row of the tab,
 * or of the detail under it), when that is still on the page.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavStack } from '../phone/nav/useNavStack.js';

/** Where a history entry keeps the details it shows. */
export const SHEETS = 'jaghelmSheets';

/** The details `state` (a history entry's) shows: [{ screen, params }], none by default. */
export function sheetsOf(state) {
  const list = state?.[SHEETS];
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.screen === 'string')
    .map((e) => ({ screen: e.screen, params: e.params ?? {} }));
}

const same = (a, b) =>
  a.length === b.length &&
  a.every(
    (e, i) =>
      e.screen === b[i].screen && JSON.stringify(e.params) === JSON.stringify(b[i].params ?? {})
  );

/**
 * The nav the screens are given (`{ stack, current, canPop, push, pop, reset }`,
 * useNavStack's), for the tab `tab`, plus `details`: the entries over the
 * tab, each drawn as a sheet.
 */
export function usePhoneNav(tab) {
  const root = useMemo(() => ({ screen: tab }), [tab]);
  const nav = useNavStack(root);
  const latest = useRef(nav);
  latest.current = nav;
  // What opened each detail, by its place on the stack.
  const openers = useRef([]);

  // The stack as the history entry has it: the tab, then its details.
  const sync = useRef(null);
  sync.current = () => {
    const want = sheetsOf(window.history.state);
    const now = latest.current.stack.slice(1);
    const rootNow = latest.current.stack[0]?.screen;
    if (rootNow === tab && same(now, want)) return;
    latest.current.reset(root);
    for (const e of want) latest.current.push(e.screen, e.params);
  };

  // A new tab starts from the entry it opens on (none, unless it is reloaded
  // or come back to with a detail open).
  useLayoutEffect(() => sync.current(), [tab]);

  // Back and Forward.
  useEffect(() => {
    const onPop = () => sync.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const details = useMemo(() => nav.stack.slice(1), [nav.stack]);

  // Focus back on what opened the first detail that closed.
  const shown = useRef(details.length);
  useLayoutEffect(() => {
    const was = shown.current;
    shown.current = details.length;
    if (details.length >= was) return;
    const opener = openers.current[details.length];
    openers.current.length = details.length;
    if (opener?.isConnected) opener.focus();
  }, [details.length]);

  return useMemo(
    () => ({
      stack: nav.stack,
      current: nav.current,
      canPop: nav.canPop,
      details,
      push(screen, params = {}) {
        openers.current[details.length] = document.activeElement;
        const state = window.history.state ?? {};
        const next = [...sheetsOf(state), { screen, params }];
        window.history.pushState({ ...state, [SHEETS]: next }, '');
        nav.push(screen, params);
      },
      pop() {
        if (details.length > 0) window.history.back();
      },
      reset: nav.reset,
    }),
    [nav, details]
  );
}
