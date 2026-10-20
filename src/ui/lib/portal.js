/**
 * Portalled content (a Select's list; popovers, dialogs and menus with #286)
 * renders at the end of <body>, outside the screen's `.jh-ui` root, where it
 * would lose the tokens, the scoped reset and the root's switches. The portal
 * element is therefore made a `.jh-ui` root of its own, carrying the same
 * switches as the root around the control that opened it
 * (docs/design-system.md, "Switches"). scripts/ui-stack.test.mjs fails when
 * ROOT_SWITCHES and the switches in tokens.css's header disagree.
 */
import { useCallback, useLayoutEffect, useState } from 'react';

/** The attributes a `.jh-ui` root switches on (tokens.css). */
export const ROOT_SWITCHES = Object.freeze([
  'data-theme',
  'data-accent',
  'data-density',
  'data-typeface',
]);

/** Props that make an element a `.jh-ui` root with the switches of the root around `anchor`. */
export function portalRootProps(anchor) {
  const props = { className: 'jh-ui' };
  const root = anchor?.closest?.('.jh-ui');
  for (const name of ROOT_SWITCHES) {
    const value = root?.getAttribute(name);
    if (value != null) props[name] = value;
  }
  return props;
}

/**
 * The portal root's props for the control behind `anchorRef`, read when the
 * control mounts, and `sync`, to read them again when the popup opens (the
 * screen may have switched theme or density since).
 */
export function usePortalRoot(anchorRef) {
  const [props, setProps] = useState(() => portalRootProps(null));
  const sync = useCallback(() => setProps(portalRootProps(anchorRef.current)), [anchorRef]);
  useLayoutEffect(sync, [sync]);
  return [props, sync];
}
