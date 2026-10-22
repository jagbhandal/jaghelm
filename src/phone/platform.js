import { createContext, useContext } from 'react';

/**
 * What a phone screen needs from the app that draws it (#303). The screens in
 * src/phone/ import nothing of a platform: no Capacitor plugin, nothing of the
 * Android app's mobile/src/ (scripts/phone-imports.test.mjs fails if one
 * does). The app gives them its data loop and navigation as props (`data`,
 * `nav`, `params`), and the rest here, once, around them:
 *
 *  - `openTarget(target)`: open what a screen's Open button points at (a
 *    service's own address; `target` is `{ kind, uid, url }`). The Android
 *    app's is mobile/src/open.js (http and https only, in a new window, which
 *    the WebView hands to the phone's browser).
 */
const PhonePlatformContext = createContext(null);

/** Gives the screens inside it their platform: `<PhonePlatform value={{ openTarget }}>`. */
export const PhonePlatform = PhonePlatformContext.Provider;

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
