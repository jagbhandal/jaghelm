/**
 * The phone screens' navigation on the web (#303): the shared nav stack
 * (src/phone/nav/useNavStack.js), its root
 * the open tab, and each detail pushed on it a history entry of its own,
 * under the URL of the entity it shows (#309, entityNav.js:
 * `/services?entity=services/apps:jellyfin`). So the browser's Back closes
 * the detail on top, as the phone's back button does, Forward opens it again,
 * and a reload, or the link opened anywhere, draws it again: the URL names
 * the entity, and the entry holds the details under it (`history.state`,
 * under SHEETS), so a detail opened from a detail is drawn over it. An entry
 * whose URL names an entity it holds no stack for (the link opened from
 * elsewhere, a push, a desktop's drawer resized to a phone) draws that
 * entity's detail alone.
 *
 * A detail's own Back goes back in the history when the detail was opened in
 * the page; one opened from its URL has no entry before it here, so its Back
 * leaves the URL the tab's (entityNav.js closeEntity). When a detail closes,
 * focus returns to what opened it (a row of the tab, or of the detail under
 * it), when that is still on the page.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useNavStack } from '../phone/nav/useNavStack.js';
import { entityOfRoute } from '../phone/nav/entityRoute.js';
import { closeEntity, openEntity, sheetsAt, useEntityParam } from './entityNav.js';

export { SHEETS, sheetsOf } from './entityNav.js';

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
  // The URL's entity: a change of it (a push, a close from the URL) is a sync.
  const entity = useEntityParam();

  // The stack as the history entry and its URL have it: the tab, then its details.
  const sync = useRef(null);
  sync.current = () => {
    const want = sheetsAt(window.history.state, window.location.search);
    const now = latest.current.stack.slice(1);
    const rootNow = latest.current.stack[0]?.screen;
    if (rootNow === tab && same(now, want)) return;
    latest.current.reset(root);
    for (const e of want) latest.current.push(e.screen, e.params);
  };

  // A tab starts from the entry it opens on, and follows its URL.
  useLayoutEffect(() => sync.current(), [tab, entity]);

  // Back and Forward (an entry whose URL names the same entity, but whose
  // stack differs, changes no query).
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
        const id = entityOfRoute({ screen, params });
        // Every detail the web draws shows an entity; one that doesn't has no URL.
        if (!id) return;
        openers.current[details.length] = document.activeElement;
        // A drive's alert opens its node with the drive marked (#728): the URL carries it.
        const { drive, ...held } = params;
        openEntity(id, {
          sheets: [...details, { screen, params: held }],
          drive: screen === 'node' && typeof drive === 'string' ? drive : null,
        });
      },
      // `focus`: where focus goes instead of what opened it (a Remove took
      // that off the page, #578).
      pop({ focus = null } = {}) {
        if (details.length === 0) return;
        if (focus instanceof Element) openers.current[details.length - 1] = focus;
        closeEntity();
      },
      reset: nav.reset,
    }),
    [nav, details]
  );
}
