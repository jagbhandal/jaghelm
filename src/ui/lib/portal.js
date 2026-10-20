/**
 * Portalled content (a Select's list, a dialog, a drawer, a popover, a
 * tooltip, the toasts) renders at the end of <body>, outside the screen's
 * `.jh-ui` root, where it would lose the tokens, the scoped reset and the
 * root's switches. The portal element is therefore made a `.jh-ui` root of its
 * own, carrying the same switches (docs/design-system.md, "Switches"):
 *
 *  1. those the UiRoot around it provides (root.jsx), read again whenever they
 *     change. An overlay opened from inside another (a Select in a dialog, a
 *     Confirm from a drawer) reads them there too, never from its parent's
 *     portal root, which may not have taken a change yet;
 *  2. with no UiRoot (a control in a bare `.jh-ui` element), those of the
 *     `.jh-ui` root around the control that opened it (its anchor), read when
 *     the control mounts and when the popup opens;
 *  3. with neither, the defaults: dark, violet, comfortable, Manrope.
 *
 * scripts/ui-stack.test.mjs fails when ROOT_SWITCHES and the switches in
 * tokens.css's header disagree, and when a Base UI portal in src/ui/ is not
 * given these props.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { DEFAULT_ACCENT } from '../accents.js';
import { DEFAULT_TYPEFACE } from '../typefaces.js';

/** The class that makes an element a root of the new UI (tokens.css, preflight.css). */
export const ROOT_CLASS = 'jh-ui';

/**
 * The switches, as UiRoot's props name them: the attribute each one sets on
 * the root, and the value that needs no attribute (tokens.css's defaults).
 */
export const SWITCHES = Object.freeze({
  theme: Object.freeze({ attribute: 'data-theme', default: 'dark' }),
  accent: Object.freeze({ attribute: 'data-accent', default: DEFAULT_ACCENT }),
  density: Object.freeze({ attribute: 'data-density', default: 'comfortable' }),
  typeface: Object.freeze({ attribute: 'data-typeface', default: DEFAULT_TYPEFACE }),
});

/** The attributes a `.jh-ui` root switches on (tokens.css). */
export const ROOT_SWITCHES = Object.freeze(Object.values(SWITCHES).map((s) => s.attribute));

/**
 * The attributes for switch values given by name ({ theme: 'light' }): a
 * default or a missing value sets none, as tokens.css reads no attribute as
 * the default.
 */
export function switchAttributes(values = {}) {
  const attributes = {};
  for (const [name, { attribute, default: fallback }] of Object.entries(SWITCHES)) {
    const value = values[name];
    if (value != null && value !== '' && value !== fallback) attributes[attribute] = value;
  }
  return attributes;
}

/** The switches of the UiRoot around a component, as attributes; null outside one. */
export const RootSwitchesContext = createContext(null);

/**
 * Props that make an element a `.jh-ui` root with `switches` (the attributes
 * the UiRoot around provides), or, outside any UiRoot, with the switches of
 * the root around `anchor`.
 */
export function portalRootProps(anchor, switches = null) {
  const props = { className: ROOT_CLASS };
  const root = switches ? null : anchor?.closest?.(`.${ROOT_CLASS}`);
  for (const name of ROOT_SWITCHES) {
    const value = switches ? switches[name] : root?.getAttribute(name);
    if (value != null) props[name] = value;
  }
  return props;
}

const sameProps = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
};

const NO_ANCHOR = { current: null };

/**
 * The portal root's props for the overlay opened from the element behind
 * `anchorRef` (none for a toast), and `sync`, to read them again when the
 * popup opens: outside a UiRoot, the anchor's root may have changed a switch
 * since. They are read again whenever the UiRoot's switches change, so an
 * open overlay, nested or not, follows the screen into light or compact.
 */
export function usePortalRoot(anchorRef = NO_ANCHOR) {
  const switches = useContext(RootSwitchesContext);
  // The anchor is not in the page until the first layout effect reads it.
  const [props, setProps] = useState(() => portalRootProps(null, switches));
  const sync = useCallback(() => {
    const next = portalRootProps(anchorRef.current, switches);
    setProps((prev) => (sameProps(prev, next) ? prev : next));
  }, [anchorRef, switches]);
  useLayoutEffect(sync, [sync]);
  return [props, sync];
}

/**
 * For an overlay with an open state (Base UI's Root): its portal root's props,
 * and the `onOpenChange` to give the Root, which reads the switches again on
 * opening before calling the caller's own. A controlled `open` that turns true
 * from outside reads them too.
 */
export function useOverlayPortal(anchorRef, open, onOpenChange) {
  const [props, sync] = usePortalRoot(anchorRef);
  const callback = useRef(onOpenChange);
  useLayoutEffect(() => {
    callback.current = onOpenChange;
  });
  useLayoutEffect(() => {
    if (open) sync();
  }, [open, sync]);
  const openChange = useCallback(
    (next, details) => {
      if (next) sync();
      callback.current?.(next, details);
    },
    [sync]
  );
  return [props, openChange];
}
