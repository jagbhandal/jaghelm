/**
 * The floating layer (#444): the Tooltip, Popover, Select, Dialog, Drawer and
 * Confirm, and the Sparkline's readout, are Base UI popups positioned by
 * floating-ui. None of it draws the first screen, so it lives in one chunk of
 * its own (src/ui/floating/, about 45 KB gzipped),
 * which this module loads once for all of them, on first use. Each
 * component's own module (tooltip.jsx...) keeps its API and draws its trigger
 * itself until then: the caller's element, focusable and named as before, with
 * the ARIA the closed popup gives it.
 *
 * When it loads:
 *  - on the first pointer or keyboard input on a page that has a floating
 *    component waiting (a mouse moving, a key, a touch), so it is there
 *    before the person reaches a trigger: the first screen never fetches it;
 *  - at once when a popup is asked to open from code (a controlled `open`, a
 *    `defaultOpen`), and when a Select mounts: its trigger is the control.
 *
 * Once loaded it answers at once, so a component mounted later draws Base UI
 * from its first render, as before #444. The components mounted before then
 * hand over when it arrives, Base UI drawing their trigger anew, except one
 * that has focus or is being pressed: that one stays as it is until focus
 * leaves it or the click is done, so focus never moves and a screen reader
 * never hears it twice, and no click is lost (a tooltip focused before then
 * shows on its next focus). One activated before the layer arrived (a click,
 * Enter or Space, a Select's arrow) opens its popup once it has, through Base
 * UI, as a click would, its new trigger taking focus first
 * (useFloatingTrigger); if the layer fails to load, that open is dropped
 * rather than made later.
 *
 * The client tests load the layer before a file's tests run
 * (src/testing/setup.js), as they do the lazy views (#490), and the gallery
 * before it draws; scripts/lazy-views.test.mjs holds both to it.
 */
import { cloneElement, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

/** The events that count as first use of a page. */
const FIRST_INPUT = ['pointermove', 'pointerdown', 'keydown', 'touchstart'];

/**
 * A loader for one layer: `load()` imports it once (again after a failure),
 * `get()` is the module once loaded (else null), `subscribe(fn)` calls `fn`
 * when it arrives, and `loadOnFirstInput(doc)` loads it on the first input
 * in `doc`, and on the next one again if that load failed. Pure apart from
 * `importLayer`, so a test can make its own.
 */
export function createFloatingLayer(importLayer) {
  let layer = null;
  let loading = null;
  const listeners = new Set();
  const watched = new WeakSet();
  const load = () => {
    if (layer) return Promise.resolve(layer);
    loading ??= importLayer().then(
      (module) => {
        // Undefined when chunkReload.js cancelled a failed import to reload.
        if (!module) {
          loading = null;
          return null;
        }
        layer = module;
        for (const listener of listeners) listener();
        return layer;
      },
      (error) => {
        loading = null;
        throw error;
      }
    );
    return loading;
  };
  const failed = (error) => console.error('The floating layer did not load', error);
  const loadQuietly = () => {
    // Logged; the next use asks again.
    load().catch(failed);
  };
  const loadOnFirstInput = (doc) => {
    if (layer || !doc || watched.has(doc)) return;
    watched.add(doc);
    const first = () => {
      for (const type of FIRST_INPUT) doc.removeEventListener(type, first, true);
      watched.delete(doc);
      load().catch((error) => {
        failed(error);
        // The next input asks again.
        loadOnFirstInput(doc);
      });
    };
    for (const type of FIRST_INPUT) {
      doc.addEventListener(type, first, { capture: true, passive: true });
    }
  };
  return {
    load,
    loadQuietly,
    loadOnFirstInput,
    get: () => layer,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The app's floating layer: src/ui/floating/layer.js, one chunk. */
export const floatingLayer = createFloatingLayer(() => import('../floating/layer.js'));

/**
 * The floating layer once loaded, else null (re-rendering when it arrives).
 * Until then it loads on the page's first input, or at once with `now`.
 * `from` is the layer: the app's, or a test's own (createFloatingLayer).
 */
export function useFloatingLayer(now = false, from = floatingLayer) {
  const layer = useSyncExternalStore(from.subscribe, from.get, from.get);
  useLayoutEffect(() => {
    if (layer) return;
    if (now) from.loadQuietly();
    else from.loadOnFirstInput(document);
  }, [layer, now, from]);
  return layer;
}

const chain = (first, second) => (event) => {
  first?.(event);
  second(event);
};

/**
 * The caller's element as the light trigger. A component of its own, so the
 * hand-over removes it: its cleanup runs before its element leaves the page,
 * and notes whether that element had focus, for the layer's trigger to take.
 */
function LightTrigger({ element, extra, nodeRef, handoff, onPress, onActivate, onHold }) {
  useLayoutEffect(() => {
    handoff.focus = false;
    const el = nodeRef.current;
    return () => {
      handoff.focus = el != null && el.ownerDocument.activeElement === el;
    };
  }, [handoff, nodeRef]);
  const own = element.props;
  const ownRef = own.ref;
  // The caller's ref too, the same function while it is, so a ref callback
  // isn't called again on every render.
  const ref = useCallback(
    (el) => {
      nodeRef.current = el;
      if (typeof ownRef === 'function') return ownRef(el);
      if (ownRef) ownRef.current = el;
      return undefined;
    },
    [nodeRef, ownRef]
  );
  return cloneElement(element, {
    ...extra,
    ref,
    onPointerDown: chain(own.onPointerDown, (e) => {
      if (e.button === 0) onPress();
    }),
    onClick: chain(own.onClick, onActivate),
    onFocus: chain(own.onFocus, () => onHold(true)),
    onBlur: chain(own.onBlur, () => onHold(false)),
    onKeyDown: chain(own.onKeyDown, (e) => {
      // Space clicks a button when it comes up: held, as a pressed pointer is.
      if (e.key === ' ' && !e.repeat) onPress();
      onActivate(e);
    }),
  });
}

/**
 * A floating component's trigger before and across the hand-over. Returns
 * `layer` (null while the light trigger draws: not loaded yet, or the light
 * trigger has focus or is being pressed), `handoff` for the layer's component (useHandoff in
 * src/ui/floating/handoff.js), and `light(element, props)`, the caller's
 * element as the light trigger: `props` over its own (the closed popup's
 * ARIA), its handlers kept. `opens(event)` says whether an event on it opens
 * the popup (a click by default); after one, the layer's component opens it
 * as it arrives. `ref`, if given, holds the light
 * trigger's element. `now` loads the layer at once; `from` is the layer
 * (the app's, or a test's own).
 */
export function useFloatingTrigger({
  now = false,
  opens = isClick,
  ref,
  from = floatingLayer,
} = {}) {
  const loaded = useFloatingLayer(now, from);
  const handoff = useRef({ focus: false, open: false }).current;
  const [pressed, setPressed] = useState(false);
  // Focus on the light trigger: it stays until focus leaves or it is activated.
  const [held, setHeld] = useState(false);
  const ownNode = useRef(null);
  const nodeRef = ref ?? ownNode;

  const onPress = useCallback(() => {
    setPressed(true);
    const doc = nodeRef.current?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    // Released after the click the press makes, in a later task, so the click
    // lands on the element it was pressed on; or a moment after the button or
    // key comes up without one (dragged off, cancelled).
    let fallback = null;
    const release = () => {
      for (const type of PRESS_ENDS) doc.removeEventListener(type, release, true);
      for (const type of PRESS_UPS) doc.removeEventListener(type, later, true);
      view.clearTimeout(fallback);
      view.setTimeout(() => setPressed(false), 0);
    };
    const later = () => {
      view.clearTimeout(fallback);
      fallback = view.setTimeout(release, 500);
    };
    for (const type of PRESS_ENDS) doc.addEventListener(type, release, true);
    for (const type of PRESS_UPS) doc.addEventListener(type, later, true);
  }, [nodeRef]);

  const onActivate = (event) => {
    if (event.defaultPrevented || !opens(event)) return;
    // A key that opens it (a Select's arrow) does nothing else, as with Base UI.
    if (event.type === 'keydown') event.preventDefault();
    handoff.open = true;
    setHeld(false);
    from.load().catch(() => {
      handoff.open = false;
    });
  };

  const light = (element, extra = {}) => (
    <LightTrigger
      element={element}
      extra={extra}
      nodeRef={nodeRef}
      handoff={handoff}
      onPress={onPress}
      onActivate={onActivate}
      onHold={setHeld}
    />
  );

  return { layer: pressed || held ? null : loaded, handoff, light };
}

/** What ends a press on a light trigger, and what ends it unless a click follows. */
const PRESS_ENDS = ['click', 'pointercancel'];
const PRESS_UPS = ['pointerup', 'keyup'];

/** A click (a press, or Enter or Space on a button) opens most popups. */
export const isClick = (event) => event.type === 'click';
