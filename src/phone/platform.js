import { createContext, createElement, useContext } from 'react';

/**
 * What a phone screen needs from the shell that draws it (#303). The screens
 * in src/phone/ import nothing of a platform: no native plugin, no other
 * app's code (scripts/phone-imports.test.mjs fails if one does). The shell
 * gives them its data loop and navigation as props (`data`, `nav`, `params`),
 * and the rest here, once, around them:
 *
 *  - `openTarget(target)`: open what a screen's Open button points at (a
 *    service's own address; `target` is `{ kind, uid, url }`).
 */
const PhonePlatformContext = createContext(null);

/**
 * Gives the screens inside it their platform: `<PhonePlatform value={{ openTarget }}>`.
 * A value without an `openTarget` function fails as it mounts, naming what is
 * missing, rather than when someone taps Open.
 */
export function PhonePlatform({ value, children }) {
  if (typeof value?.openTarget !== 'function') {
    throw new TypeError(
      'A <PhonePlatform> needs a value with an openTarget(target) function (src/phone/platform.js).'
    );
  }
  return createElement(PhonePlatformContext.Provider, { value }, children);
}

/**
 * The platform a screen is drawn in. Outside a PhonePlatform there is none,
 * and the screen fails to draw, rather than offering an Open that does nothing.
 */
export function usePhonePlatform() {
  const platform = useContext(PhonePlatformContext);
  if (!platform) {
    throw new Error('A phone screen is drawn outside a <PhonePlatform> (src/phone/platform.js).');
  }
  return platform;
}
