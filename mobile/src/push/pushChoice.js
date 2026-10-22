/**
 * The user's push choice on this phone (#539): on unless Turn off push set it
 * off. On its own so the sign-in and the pending cleanup can read it without
 * loading the push plugin.
 */
import { getPref } from '../storage/prefsAdapter.js';
import { PUSH_WANTED_KEY } from '../runtimeConfig.js';

export async function pushWanted() {
  try {
    return (await getPref(PUSH_WANTED_KEY)) !== 'false';
  } catch {
    return true;
  }
}
